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

function RILAPIrequest() {    
    this.keyed = true;
    
    this.APP    = Components.classes['@ril.ideashower.com/rildelegate;1'].getService().wrappedJSObject;
    this.IO = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);
    this.OBS = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
    this.STREAM = Components.classes["@mozilla.org/scriptableinputstream;1"];
    
    // If you need an API key, get one for free at http://readitlaterlist.com/api/signup/
    // Do not use this one, it does not have any special privileges and it is still rate-limited.
    // I use it to maintain usage stats, so I'd appreciate it if you didn't muddle it up :-)
    this.apikey     = 'c4cT4A38g0G92Z820ldU509d6fp5g49b';
    this.api        = 'https://readitlaterlist.com/v2/';
    this.apiText    = 'http://text.readitlater.com/v3beta/';
}

// class definition
RILAPIrequest.prototype = {

  // properties required for XPCOM registration:
  classDescription: "Pocket API Request Javascript XPCOM Component",
  classID:          Components.ID("{11F8F838-A638-11DF-8B18-917CDFD72085}"),
  contractID:       "@ril.ideashower.com/rilapirequest;1",

  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIRILAPIRequest]),

  //////////////////////////////////////////    
    
    initAndStart : function(method, login, params, errorReporting, methodDescription)
    {
        this.init(method, login, params, errorReporting, methodDescription);
        this.start();
        return this.requestId;
    },
    
    init : function(method, login, params, errorReporting, methodDescription)
    {        
        this.method = method;
        this.login = login;
        this.params = params;
	this.methodDescription = methodDescription;
        this.errorReporting = errorReporting ? errorReporting : 'all';
        
        // Make request id
        this.requestId = this.APP.now() + this.method + this.params + Math.random();
        
        return this.requestId;
    },
    
    // -- //
    
    start : function ()
    {
	try {
            var url;
            
            this.isTextView = (this.method == 'firefox');
            
            if (this.isTextView)
                url = this.apiText + 'firefox';
            else
                url = this.api + this.method;
	    
	    // Params
	    var params = this.params;
	    if (this.keyed) params += '&apikey='+this.apikey;
	    if (this.login)
	    {
		var currentLogin = this.APP.getLogin();
		if (currentLogin)
		    params += '&username='+this.APP.e(currentLogin.username)+'&password='+this.APP.e(currentLogin.password);
	    }
	    
	    this.APP.d('--');
	    this.APP.d(url);
	    this.APP.d(params);
	    this.APP.d('--');
	    
            var self = this;
	    this.request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
            this.request.open("POST", url, true);        
            this.request.onreadystatechange = function(e){ self.onReadyStateChange.call(self, e); };
            this.request.withCredentials = true;
            
            this.request.setRequestHeader("User-Agent" , 'Pocket Firefox ' + this.APP.v);
            this.request.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
            
            if (this.isTextView)
                this.request.overrideMimeType('text/plain; charset=x-user-defined');
            
	    this.request.send(params);
            
	    return;
	} catch(e){Components.utils.reportError(e);}
	
	// else
	this.transport = {status:0};
	this.finished();
    },
	    
    onReadyStateChange : function(e)
    {
	if (this.request.readyState == 4)
        {                  
            this.finished();
        }	
    },
    
    // -- //
    
    finished : function()
    {
	try
        {
            this.success = (this.request.status == '200');
            this.response = this.request.responseText;
	    this.status = this.request.status;
	                
            if (!this.success)
            {
            
                this.error = this.header('X-Error') ? this.header('X-Error') : 'Could not reach Pocket.  Make sure you are connected to the internet.';
                
                // Error
                if (this.errorReporting != 'none')
                {
                    
                    if (this.request.status == '401')
                    {
                        this.APP.genericMessage('Your username and password are not correct.\nIf you recently changed your username and/or password, you will need to relogin.',
                                           [
                                            {label:'Relogin', delegate:this.APP.getTopRIL(), selector:'relogin'},
                                            {label:'Get Help', delegate:this.APP.getTopRIL(), selector:'getHelp'}
                                           ], false, 'Sync', true);
                        
                    }
                    else
                    {
                        var action = this.methodDescription == 'read' ? 'getting your archive' : 'syncing';
                        this.APP.genericMessage('There was a problem while ' + action + ':\n'+this.error,
                                           [
                                            {label:'Try Again', delegate:this.methodDescription == 'read' ? this.APP.getTopRIL() : this.APP.SYNC, selector: this.methodDescription == 'read' ? 'updateReadList' : 'sync'},
                                            {label:'Get Help', delegate:this.APP.getTopRIL(), selector:'getHelp'}
                                           ], false, 'Sync', true);
                    }
                    
                }
                
            }
            
            this.OBS.notifyObservers(this, 'ril-api-request-finished', this.requestId);
	} catch(e) {Components.utils.reportError(e);}
    },
    
    setHeader : function(name, value)
    {
	return this.request.getResponseHeader(name);	
    },
    
    header : function(name)
    {
	if (this.request)
	    return this.request.getResponseHeader(name);	
    }
    
};

/**
* XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4).
* XPCOMUtils.generateNSGetModule is for Mozilla 1.9.2 (Firefox 3.6).
*/
if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([RILAPIrequest]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([RILAPIrequest]);
