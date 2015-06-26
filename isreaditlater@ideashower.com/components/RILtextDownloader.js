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

function RILtextDownloader() {
    this.type           = 1;           
}

// class definition
RILtextDownloader.prototype = {

  // properties required for XPCOM registration:
  classDescription: "Pocket Text Downloader Javascript XPCOM Component",
  classID:          Components.ID("{40A8E616-A638-11DF-8B8D-C57CDFD72085}"),
  contractID:       "@ril.ideashower.com/riltextdownloader;1",

  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIRILtextDownloader]),

  //////////////////////////////////////////    
    
    init : function(itemId, url, callback)
    {                
        this.itemId = itemId;
        this.url = url;
        this.callback = callback ? callback : 'textFinished';
        
        this.APP    = Components.classes['@ril.ideashower.com/rildelegate;1'].getService().wrappedJSObject;        
        this.ASSETS = Components.classes['@ril.ideashower.com/rilassetmanager;1'].createInstance(Components.interfaces.nsIRILassetManager);
	this.ASSETS.init();
        this.JSON   = Components.classes["@mozilla.org/dom/json;1"].createInstance(Components.interfaces.nsIJSON);
        this.markupPath = this.ASSETS.folderPathForItemId( itemId ) + 'text.html';
	
	this.requestId = itemId + '-' + url + '-' + Math.random();
	return this.requestId;
    },
    
    
     // Run on the main thread because of ajax request
    start : function(threadId)
    {
	try
	{
	    this.threadId = threadId;
	    this.APP.SYNC.request( 'firefox', false, '&url='+this.url, this, 'textCallback', 'none');
	    return;
	} catch(e){Components.utils.reportError(e);}
	
	//else
	this.finish(false);
    },
    
    // This is performed on the main thread
    textCallback : function(request, success, response)
    {
	try {
	
        if (this.finished) return false;
	        
	this.APP.d( 'status: ' + request.status );  
	this.APP.d( 'X-Error: ' + request.error );
	
	if (!request.success)
	{
	    this.finish( false, request.status );
	    this.error = request.error;	    
	}
	else
	{	
	    // Update stylesheet
	    var markup = request.response;
	    
	    markup = markup.replace('<!--!ENDOFHEADSECTION-->', '<link type="text/css" rel="stylesheet" href="chrome://isreaditlater/content/text.css" /><script type="text/javascript" src="chrome://isreaditlater/content/text.js"></script>');
	    markup = markup.replace('<!--RILEND-->',
		'<a class="i" id="RIL_settings"></a>');
	    	    
	    // -- Save text to file
	    
	    // Write file in thread
            this.APP.OFFLINE.write( this.markupPath, markup, true, this, 'finish');
	    
	}
	
	} catch(e) {Components.utils.reportError(e);}
    },
    
    finish : function(success, statusCode)
    {
        this.finished = true;
        this.success = success;
        this.statusCode = statusCode ? statusCode : (success ? 1 : -1);
        this.APP.OFFLINE[this.callback].call(this.APP.OFFLINE, this);
    },
    
    cancel : function(soft)
    {
        //dump("\n -- cancelling.. ");
        
        this.finished = true;
        
    }    
    
};

/**
* XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4).
* XPCOMUtils.generateNSGetModule is for Mozilla 1.9.2 (Firefox 3.6).
*/
if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([RILtextDownloader]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([RILtextDownloader]);

