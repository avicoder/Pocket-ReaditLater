/*
 
License: This source code may not be used in other applications whether they
be personal, commercial, free, or paid without written permission from Pocket.
 
 
/////////
DEVELOPER API: readitlaterlist.com/api/
/////////

If you would like to customize Pocket or build an application that works with
Pocket take a look at the Pocket OPEN API:
http://readitlaterlist.com/api/

Suggestions for additions to Pocket are VERY welcome.  A large number of user
suggestions have been implemented.  Please let me know of any additional features you
are seeking at: http://readitlaterlist.com/support/

Thanks
 
*/

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function RILofflineQueue() {
    this.wrappedJSObject = this;        
    this.maxThreads = 2; // increasing this will speed up downloading but will slow down firefox performance
    this.threads = [];
}

// class definition
RILofflineQueue.prototype = {

  // properties required for XPCOM registration:
  classDescription: "Pocket Offline Queue Javascript XPCOM Component",
  classID:          Components.ID("{85C02A70-A638-11DF-90FB-FE7CDFD72085}"),
  contractID:       "@ril.ideashower.com/rilofflinequeue;1",
  
  QueryInterface: XPCOMUtils.generateQI(),



    //////////////////////////////////
    
    init : function()
    {
        this.APP    = Components.classes['@ril.ideashower.com/rildelegate;1'].getService().wrappedJSObject;
        this.PREFS = Components.classes['@ril.ideashower.com/rilprefs;1'].getService().wrappedJSObject;
        this.JSON   = Components.classes["@mozilla.org/dom/json;1"].createInstance(Components.interfaces.nsIJSON);
        this.OBS = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);        
    },
        
    start : function(resetQueue, doNotLoadQueue)
    {	
	
	if (resetQueue && this.downloading) return -1;	
	this.downloading = true;
	
	if (!doNotLoadQueue)
	    this.loadQueue(this.PREFS.getBool('getOfflineWeb'), this.PREFS.getBool('getOfflineText'), resetQueue);
	
        if (!this.queue || this.queue.length == 0) {
	    this.downloading = false;
            return -2;
        }
	// Create threads
	if (resetQueue || !this.threads || this.threads.length == 0)
	    this.createThreads(true);
	
	return true;
    },
    
    
    makeSureQueueIsInit : function(force)
    {
	if (force || !this.queue)
	{
	    this.pointer = 0;	
	    this.counters = {success:0,failed:0};
	    this.queue = [];
	    this.idsInTheQueue = {'2':{},'1':{}};
	}  
    },
    
    loadQueue : function(downloadWeb, downloadText, resetQueue)
    {
	
	this.makeSureQueueIsInit(resetQueue);
        
        var item, downloadingAtLeastOneView;
	
	// sort list so newest is first
        var sortedList = this.APP.sortList(this.APP.LIST.list.slice());
        
        for(var i in sortedList)
        {
            downloadingAtLeastOneView = false;
            item = sortedList[i];
	    
	    this.addItemToQueue(item, {web:downloadWeb,text:downloadText});
        }
        
    },
    
    addItemToQueue : function(item, views, startIfNotStarted)
    {
	this.makeSureQueueIsInit();
	
	// if it's already in the queue, skip it	
	if (!views) views = {web:this.PREFS.getBool('getOfflineWeb'), text:this.PREFS.getBool('getOfflineText')};
	
	// add specific views to queue
	if (views.web && item.offlineWeb != 1 && !this.idsInTheQueue[2][item.itemId])
	{
	    this.addToQueue(item.itemId, item.url, 2, startIfNotStarted);
	}
	if (views.text && item.offlineText != 1 && !this.idsInTheQueue[1][item.itemId])
	{
	    this.addToQueue(item.itemId, item.url, 1, startIfNotStarted);
	}
    },
    
    addToQueue : function(itemId, url, type, startIfNotStarted)
    {
	if (this.clearingOffline) return false;
	
        var downloader;
        
        if (type == 1)
            downloader = Components.classes["@ril.ideashower.com/riltextdownloader;1"].createInstance(Components.interfaces.nsIRILtextDownloader);
        else if (type == 2)
            downloader = Components.classes["@ril.ideashower.com/rilwebdownloader;1"].createInstance(Components.interfaces.nsIRILwebDownloader);
        
        if (downloader)
        {
            downloader.init( itemId, url );
            this.queue.push( downloader );
	    this.idsInTheQueue[type][itemId] = true;
        }
	
	if (startIfNotStarted) {
	    if (!this.downloading) return this.start(true, true);
	    
	    // else
	    if (!this.next()) {
		this.updateProgress();
	    }
	}
        
    },    
    
    createThreads : function(loadNextRightAway)
    {
	this.threads = [];
	
	for(var i=0; i<this.maxThreads; i++) {
	    this.threads[i] = {
		id : i,		
		inUse : false
	    }
	    
	    if (loadNextRightAway) this.next();
	}
    },
    
    next : function()
    {
        // check if still online
        
        var mainWindow = this.APP.getMainWindow();
        if (mainWindow && mainWindow.navigator && !mainWindow.navigator.onLine)
        {   // if it can't access the navigator, assume still online
            this.cancel();
            return;
        }
	
	var nextItem = this.queue[this.pointer];
	
	if ( nextItem )
	{
	    // make sure the item still exists (wasn't marked as read)
	    var item = this.APP.LIST.itemById(nextItem.itemId);
	    if (!item)
	    {
		this.pointer++; //skip it
		return this.next();
	    }
	    
	    
	    var thread = this.getAnOpenThread();
	    
	    if (thread) {
		
		this.pointer++;
		this.updateProgress();
		
		//this.d("\nstarting "+nextItem.url);
		
		// load thread
		thread.downloader = nextItem;
                nextItem.start(thread.id);
		
		return true;
	    
	    } // no threads are open, do not advance the pointer, after a thread completes it will come back here
	}
	else
	{	    
	    //this.d('nothing to next');
	    
	    for(var i in this.threads)
	    {
		if (this.threads[i].inUse) {
                    //dump("\n\nthread still open")
		    //this.d('thread '+i+ ' is still open: '+this.threads[i].downloader.itemId + ' : ' +this.threads[i].downloader.url )
		    return; // a thread is still processing, do not end queue yet
		}
	    }
	    
	    // Complete
            //dump("\n\n\nQUEUE IS DONE")
            this.queueIsDone();
	    
	}
	
    },
    
    getAnOpenThread : function() {
	if (!this.threads) this.createThreads();
	
	for(var i in this.threads)
	{
	    if (!this.threads[i].inUse) {
		this.threads[i].inUse = true;
		return this.threads[i];
	    }
	}
    },
    
    updateProgress : function(turnOff)
    {
	if (!this.queue) this.queue = [];
        this.APP.updateDownloadProgress( turnOff?-1:this.pointer , this.queue.length );
    },
    
    textFinished : function(downloader)
    {
        this.itemIsDone(downloader.itemId, downloader.type, downloader.threadId, downloader.success, downloader.statusCode);
    },
    
    itemIsDone : function(itemId, type, threadId, success, statusCode, retainDomains)
    {        
        if (this.downloading)
	{
	    // make sure the item still exists (wasn't marked as read)
	    var item = this.APP.LIST.itemById(itemId);
	    if (item)
	    {	    
		//this.d("\n\nitem is done | \n threadId:" + threadId + " \nsuccess: "  + success + " \n url: " + item.url + " \n type: " + type + "\nstatusCode: " + statusCode + ' | ' + retainDomains);
		this.APP.LIST.updateOffline(itemId, type, statusCode, retainDomains);	    
		this.counters[ success ? 'success' : 'failed' ]++;
	    }
	    
	    this.threads[ threadId ].inUse = false;
            this.next();
	}
    },
    
    queueIsDone : function()
    {
	//this.d('queueIsDone');
	if (this.downloading)
	{
	    this.pointer = this.queue.length+1; //set it to +1 over the queue length so updateProgress knows we are done
	    this.updateProgress();
	    this.downloading = false;
	    this.threads = {};
	    this.queue = null;
	}
    },
    
    cancel : function()
    {
	this.downloading = false;
	this.updateProgress(true);
	for(var i in this.threads)
	{
            if (this.threads[i].downloader)
                this.threads[i].downloader.cancel();
	}
	this.threads = false;
	this.queue = null;
    },
    
    // -- //
    
    downloadTextWrapper : function(itemId, url, delegate, doc)
    {
        if (!this.textViewDownloads) this.textViewDownloads = {};
        
        var set = {doc: doc, delegate: delegate};
        set.downloader = Components.classes["@ril.ideashower.com/riltextdownloader;1"].createInstance(Components.interfaces.nsIRILtextDownloader);
        this.textViewDownloads[set.downloader.init( itemId, url, 'textViewReady')] = set;
	set.downloader.start(null);  
    },
    
    textViewReady : function(downloader)
    {
        var set = this.textViewDownloads[ downloader.requestId ];
        if (set.delegate)
            set.delegate['textViewReady'].call(set.delegate, downloader, set.doc);
    },
    
    
    // -- Writing / Files
    
    write : function(path, data, noEncoding, delegate, selector)
    {
    
        try {
            
	    // Create file paths
            var file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
            file.initWithPath( path );
            
            // Create needed directories to file
            if (!file.exists()) file.createUnique( Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0777);


            // - Async write
            
            // Then, we need an output stream to our output file.
            var ostream = Components.classes["@mozilla.org/network/file-output-stream;1"].
                          createInstance(Components.interfaces.nsIFileOutputStream);
            ostream.init(file, -1, -1, 0);
            
            var istream;
            if (noEncoding)
            {                
                // Finally, we need an input stream to take data from.
                istream = Components.classes["@mozilla.org/io/string-input-stream;1"].
                              createInstance(Components.interfaces.nsIStringInputStream);
                            
                istream.setData(data, data.length);
            }
            
            else
            {
                // Obtain a converter to convert our data to a UTF-8 encoded input stream.
                var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                                .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
                converter.charset = "UTF-8";
            
                // Asynchronously copy the data to the file.
                istream = converter.convertToInputStream(data);
            }
            
            // Start saving
            this.asyncCopy(istream, ostream, this.APP.genericClosure(delegate, selector));  
	    
	    return true;
	    
        } catch(e) {
            Components.utils.reportError('Error saving file: ' + path + "\n" + e);
        }
    },
    
    // copied from http://mxr.mozilla.org/mozilla-central/source/netwerk/base/src/NetUtil.jsm#77
    // which replaces https://developer.mozilla.org/en/JavaScript_code_modules/NetUtil.jsm#asyncCopy
    // TODO when 3.6 is out, this will only be required for older browsers
    asyncCopy: function (aSource, aSink, aCallback)
    {
         if (!aSource || !aSink) {
             var exception = new Components.Exception(
                 "Must have a source and a sink",
                 Cr.NS_ERROR_INVALID_ARG,
                 Components.stack.caller
             );
             throw exception;
         }
 
         var sourceBuffered = true;//ioUtil.inputStreamIsBuffered(aSource);
         var sinkBuffered = true;//ioUtil.outputStreamIsBuffered(aSink);
 
         var ostream = aSink;
         if (!sourceBuffered && !sinkBuffered) {
             // wrap the sink in a buffered stream.
             ostream = Components.classes["@mozilla.org/network/buffered-output-stream;1"].
                       createInstance(Components.interfaces.nsIBufferedOutputStream);
             ostream.init(aSink, 0x8000);
             sinkBuffered = true;
         }
 
         // make a stream copier
         var copier = Components.classes["@mozilla.org/network/async-stream-copier;1"].
             createInstance(Components.interfaces.nsIAsyncStreamCopier);
 
         // Initialize the copier.  The 0x8000 should match the size of the
         // buffer our buffered stream is using, for best performance.  If we're
         // not using our own buffered stream, that's ok too.  But maybe we
         // should just use the default net segment size here?
         copier.init(aSource, ostream, null, sourceBuffered, sinkBuffered,
                     0x8000, true, true);
 
         var observer;
         if (aCallback) {
             observer = {
                 onStartRequest: function(aRequest, aContext) {},
                 onStopRequest: function(aRequest, aContext, aStatusCode) {
                    var success = (Components.isSuccessCode(aStatusCode));
                    aCallback(success);
                 }
             }
         } else {
             observer = null;
         }
 
         // start the copying
         copier.asyncCopy(observer, null);
         return copier;
    },
    
    // -- //
    
    setOfflineStatus : function(action, state)
    {
        this[action+'Offline'] = state;
        
        // update assets directories
        if (action == 'moving' && !state)
            this.APP.ASSETS.init();
        
        // update options window
        this.APP.commandInAllOpenWindows('RILoptions', 'offlineStatusChanged', null, true, true);
    },
    
    // -- //
    
    d : function(str) { return dump(str+"\n"); },  
     
};


/**
* XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4).
* XPCOMUtils.generateNSGetModule is for Mozilla 1.9.2 (Firefox 3.6).
*/
if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([RILofflineQueue]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([RILofflineQueue]);

