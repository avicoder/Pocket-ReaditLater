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

function RILwebDownloader() {
    this.type           = 2;
    this.timeout        = 30 * 1000; //
    this.maxActiveRequests = 4; // increasing this will speed up downloading but will reduce Firefox performance    
    this.maxImages      = 300;
    this.maxStylesheets = 30;
    
    this.requests = [];
    this.activeRequests     = 0;
    this.assetQueueCount   = 0;
    this.imageCount         = 0;
    this.stylesheetCount    = 0;
    
    this.threads = [];
    this.imagesQueue = [];
    this.stylesheetQueue = [];
    this.dupeCheckAbsolute = {};   
        
    this.retainDomains = {};         
}

// class definition
RILwebDownloader.prototype = {

  // properties required for XPCOM registration:
  classDescription: "Pocket Web Page Downloader Javascript XPCOM Component",
  classID:          Components.ID("{555101E8-A638-11DF-B51F-C97CDFD72085}"),
  contractID:       "@ril.ideashower.com/rilwebdownloader;1",

  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIRILwebDownloader]),

  //////////////////////////////////////////    
    
    // setup
    
    dealloc : function()
    {
        this.APP = null; 
        this.ASSETS = null;
        this.JSON = null;
        this.markup = null;
        this.markupPath = null; 
        this.requests = null;
        this.threads = null;
        this.imagesQueue = null;
        this.stylesheetQueue = null;
        this.dupeCheckAbsolute = null;
        this.retainDomains = null;
    },
    
    init : function(itemId, url)
    {                
        this.itemId = itemId;
        this.url = url;
        
        this.APP    = Components.classes['@ril.ideashower.com/rildelegate;1'].getService().wrappedJSObject;        
        this.ASSETS = Components.classes['@ril.ideashower.com/rilassetmanager;1'].createInstance(Components.interfaces.nsIRILassetManager);
        this.ASSETS.init();
        this.JSON   = Components.classes["@mozilla.org/dom/json;1"].createInstance(Components.interfaces.nsIJSON);
        this.markupPath = this.ASSETS.folderPathForItemId( itemId ) + 'web.html';
        
        this.fileDownloaderPrototype();
    },
    
    start : function(threadId)
    {
        //this.APP.d('start downloading ' + this.url);
        this.threadId = threadId;
        this.request(this.url, false, this, this.markupCallback);       
    },
    
    

    // Handling file and assets requests
    
    request : function(url, isBinary, delegate, callback, itemInfo, wait)
    {
        //this.APP.d('request');
        var request = new this.fileDownloader(url, isBinary, delegate, callback);
        request.itemInfo = itemInfo;
        this.requests.push(request);
        if (!wait) this.popRequest();
        return request;
    },
    
    popRequest : function()
    {
        if (this.requests && this.activeRequests <= this.maxActiveRequests && this.requests.length > 0 && !this.finished)
        {
            this.activeRequests++;
            var request = this.requests.shift();
            if (request) request.start();
        }
    },
    
    requestAsset : function(data)
    {
        if (this.finished) return;
        
        //this.APP.d('requestAsset');
        var itemInfo = data.itemInfo;
        var type = data.type;
                
        // If still under max asset caps (should this be a byte level cap rather than #)?
        if ( (type == 1 && this.imageCount < this.maxImages) || (type == 2 && this.stylesheetCount < this.maxStylesheets) ) {
        
            // Make sure the asset doesn't already exist and then begin downloading
            // they don't download at same time
            if ( !this.dupeCheckAbsolute[ itemInfo.absolute ] && !itemInfo.assetExists )
            //if ( !this.dupeCheckAbsolute[ itemInfo.absolute ] ) //for testing to skip exists check
            {
                
                var request = this.request(itemInfo.absolute, (type==1), this, type==1?this.imageAssetFinished:this.stylesheetAssetFinished, itemInfo, true);
            
                // Add to queue
                if (type == 1)
                {                    
                    this.imagesQueue.push(request);
                    this.imageCount++;
                }
                else if (type == 2)
                {
                    this.stylesheetQueue.push(request);
                    this.stylesheetCount++;
                }
                this.assetQueueCount++;
        
                //dump("\n " + this.stylesheetCount + ' + ' + this.imageCount + ' = ' + this.assetQueueCount);
                
                // Start the connection            
                this.popRequest();
                
                // Add to checks
                this.dupeCheckAbsolute[ itemInfo.absolute ] = true;  
                
            }
        }
                            
        // Log for retain count regardless if we opened the connection here
        this.addRetainDomain( itemInfo.assetDomain );        
        
    },
    
    requestFinished : function()
    {
        this.activeRequests--;
        this.popRequest();
    },
        
    // process
    
    processorEvent : function(data)
    {
        this[data.selector].call(this, data);
    },
    
    process : function( data )
    {
        data.assetPaths = this.APP.JSON.decode(this.ASSETS.getPaths());
        
        var self = this;
        // because the web worker is created on the top RIL, does it cause problems when windows are closed?
        var worker = this.APP.getWebWorker("chrome://isreaditlater/content/processor.js");        
        worker.onmessage = function(event){ self.processorEvent(event.data); }
        worker.postMessage( data );
        this.threads.push(worker);
    },
    
    markupCallback : function(downloader)
    {
      //  this.APP.d('markupCallback ' + this.url);
        this.requestFinished();
        if (!downloader.success) return this.finish(false);
        
        this.imagesProcessed = false;
        this.stylesheetsProcessed = false;
        
        this.process( {
            action  : 'processMarkup',
            selector: 'markupProcessed',
            markup  : downloader.data,
            url     : this.url
        } );       
    },
    
    markupProcessed : function(data)
    {
        //this.APP.d('markupProcessed ' + markup);
        this.imagesProcessed = true;
        this.stylesheetsProcessed = true;
        this.markup = data.markup;
        this.checkIfFinished();
    },   
    
    imageAssetFinished : function( downloader )
    {
        if (this.finished) return;
        this.requestFinished();
        
        try
        {
            if (downloader.success && downloader.data)
            {                
                // Save the image to a file - no delegate callback, if it works it works
                this.APP.OFFLINE.write(downloader.itemInfo.assetPath, downloader.data , true);
                        
                
            }
            
        } catch(e) { Components.utils.reportError(e); }
        
        
        downloader = null;
        this.assetFinished();
        
    },
    
    stylesheetAssetFinished : function( downloader )
    {
        if (this.finished) return;
                //this.APP.d('stylesheetAssetFinished ' + this.url);
        this.requestFinished();
        
        try {
            
            if (downloader.success && downloader.data)
            {
                     
                this.imagesProcessed = false;
                this.stylesheetsProcessed = false;
                
                // Process the css file
                this.process( {
                    action  : 'processStylesheet',
                    selector: 'stylesheetProcessed',
                    markup  : downloader.data,
                    url:downloader.itemInfo.absolute,
                    itemInfo:downloader.itemInfo
                } );    
            }
            
        } catch(e) {
            Components.utils.reportError(e);
            return;
        }
        
        downloader = null;
        this.assetFinished();
        
    },
    
    stylesheetProcessed : function(data)
    {
        if (this.finished) return;
                //this.APP.d('stylesheetProcessed ' + this.url);
        this.imagesProcessed = true;
        this.stylesheetsProcessed = true;
        
        // Save the css to a file - no delegate callback, if it works it works
        this.APP.OFFLINE.write( data.itemInfo.assetPath, data.markup, true ); 
        this.assetFinished();       
    },
   
    assetFinished : function()
    {
                //this.APP.d('assetFinished ' + this.url);
        this.assetQueueCount--;
        this.checkIfFinished();
    },
    
    checkIfFinished : function(force)
    {
        //this.APP.d('checkIfFinished ' + this.assetQueueCount + ' | ' + this.imagesProcessed + ' | ' + this.stylesheetsProcessed);
        
        if (this.finished || this.finishing) return true;
        
        if (force || (this.assetQueueCount == 0 &&
            this.imagesProcessed &&
            this.stylesheetsProcessed))
        {
            this.finishing = true;
            //this.APP.d('finishing');
            
            // Do remaining markup cleanup - strip absolutes
            if (this.markup)
                this.markup = this.markup.replace(/([\s"'])(background|src)=["']https?:([^"']*)["']/gi, '$1$2=""');
            
            // Add content type if it isn't set
            if (this.markup && !this.markup.match(/http-equiv="content-type/i))
                this.markup += '<meta http-equiv="content-type" content="text/html; charset=UTF-8">';
            
            // Save markup to file
            this.APP.OFFLINE.write( this.markupPath, this.markup, false, this, 'finish');
            
            return true;
        }
        
        // reset timeout
        if (this.timeoutTO)
            this.timeoutTO = this.APP.clearTimeout( this.timeoutTO );
        this.timeoutTO = this.APP.setTimeout(this.timedOut, this.timeout, this, false, this.timeoutTO);        
        
        return false;
        
    },
    
    finish : function(success, statusCode)
    {
        this.APP.d('finish? ' + this.url);
        if (this.finished) return;
        
        if (this.timeoutTO)
            this.timeoutTO = this.APP.clearTimeout( this.timeoutTO );
            
        this.finished = true;
        this.success = success;
        this.statusCode = statusCode ? statusCode : success ? 1 : -1;
        this.APP.OFFLINE.itemIsDone(this.itemId, this.type, this.threadId, this.success, this.statusCode, this.retainDomains);
        this.shutdownThreads();
        
        this.dealloc();
    },
    
    timedOut : function()
    {
        //dump("\n -- timing out.. " + this.assetQueueCount);
        if (this.finished) return false;
        
        this.cancel(true);
        
        // decide if we should return an error or just skip waiting assets
        if (!this.imagesProcessed || !this.stylesheetsProcessed)
        {
            this.finish(false);
        }
        else
        {
            this.checkIfFinished(true); // force it to finish 
        }        
    },
    
    cancel : function(soft)
    {
        //dump("\n -- cancelling.. " + this.assetQueueCount);
        
        this.APP.clearTimeout( this.timeoutTO );
        
        this.shutdownThreads();
        
        if (!soft)
        {
            this.finished = true;
        }
        
    },
    
    shutdownThreads : function()
    {
        try {
            for(var i in this.threads)
            {
                if (this.threads[i])
                {
                    this.threads[i].terminate();
                    this.threads[i] = null;
                }
            }
            this.threads = null;
            this.threads = [];
        } catch(e) { Components.utils.reportError(e); }
    },
    
    addRetainDomain : function(path)
    {	
        this.retainDomains[ path ] = path;
    },
    
    getRetainDomains : function()
    {
        return this.JSON.encode(this.retainDomains);
    },
    
    
    
    // --- //
    
    fileDownloader : function(url, isBinary, delegate, callback)
    {
        this.url = url;
        this.isBinary = isBinary;
        this.delegate = delegate;
        this.callback = callback;
        
        this.data = "";
    },
    
    fileDownloaderPrototype : function()
    {
        
        this.fileDownloader.prototype =
        {
            
            start : function()
            {
                //dump("\nstart file: " + Components.classes["@mozilla.org/thread-manager;1"].getService().isMainThread + this.url);
                try
                {
                    if (this.url)
                    {
                        try {
                            this.startXMLhttpRequest();
                        } catch(e)
                        {
                           dump("\nfileDownloader Error x1 : " + e);
                             //Components.utils.reportError(e);
                        }
                        
                        return;
                    }
                } catch(e){
                    dump("\nfileDownloader Error x2 : " + e);
                    //Components.utils.reportError(e);
                }
                
                //else
                this.finish(false);
                
            },
                        
            // XMLhttpRequest - used for text pages
            
            startXMLhttpRequest : function()
            {
                var self = this;
                this.request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);  
                this.request.open("GET", this.url, true);        
                this.request.onreadystatechange = function(e){ self.onReadyStateChange.call(self, e); };
                this.request.withCredentials = true;
                
                if (this.isBinary)
                {
                    this.request.overrideMimeType('text/plain; charset=x-user-defined');  
                }
                
                this.request.send();
            },
            
            onReadyStateChange : function(e)
            {
                //dump("\nonReadyStateChange: " + this.request.readyState + ' | '  + this.url);
                /* - TODO - implement this
                if (this.request.readyState == 2 && this.request.channel.originalURI.spec != this.request.channel.URI.spec)
                {
                    if ( this.delegate.dupeCheckAbsolute[ this.request.channel.URI.spec ] )
                    {
                        // would either need to make a copy of the file (assuming its already been downloaded)
                        // or would have to update the source's literal with the new location
                        // in that case it would have to know which source to update (css or markup)
                        // best solution would likely be simlinks
                        this.request.abort();
                        dump("\n dupe aborted");
                    }
                    else
                    {
                        // Add it to the checker
                        this.delegate.dupeCheckAbsolute[ this.request.channel.URI.spec ] = true;
                    }
                }
                else*/ if (this.request.readyState == 4)
                {
                    if (this.request.status == 200)
                    {                                               
                        this.data = this.request.responseText;
                        this.finish(true);               
                    }
                    else
                    {
                        this.finish(false);
                    }
                }
            },   
            
            // Finish
            
            finish : function(success)
            {
                //dump("\nfinish: " + this.url);
                
                this.finished = true;
                this.success = success;
                this.callback.call(this.delegate, this);
            }
            
        }
    }
    
    
};

/**
* XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4).
* XPCOMUtils.generateNSGetModule is for Mozilla 1.9.2 (Firefox 3.6).
*/
if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([RILwebDownloader]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([RILwebDownloader]);

