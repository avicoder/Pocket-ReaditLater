Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function RILprefs() {
    this.wrappedJSObject = this;
    
    // move preferences to .extensions. branch
    
    var branchLegacy = Components.classes["@mozilla.org/preferences-service;1"]
		.getService(Components.interfaces.nsIPrefService).getBranch("isreaditlater.");
                
    var branch = Components.classes["@mozilla.org/preferences-service;1"]
		.getService(Components.interfaces.nsIPrefService).getBranch("extensions.isreaditlater.");
    
    if (branchLegacy.prefHasUserValue('version'))
        this.PREFS = branchLegacy;
    
    else
        this.PREFS = branch;
}

// class definition
RILprefs.prototype = {

  // properties required for XPCOM registration:
  classDescription: "Pocket Prefs Javascript XPCOM Component",
  classID:          Components.ID("{95C7CB1C-A638-11DF-9F85-197DDFD72085}"),
  contractID:       "@ril.ideashower.com/rilprefs;1",
  
  QueryInterface: XPCOMUtils.generateQI(),



    //////////////////////////////////
    // Save prefs
    
    set : function(name, value)
    {
        switch( typeof value )
        {
            case('boolean'):
                try{
		    this.PREFS.setBoolPref(name, value);
		    break;
		} catch(e) {
		    
		    try {
			this.remove(name);
			this.PREFS.setBoolPref(name, value);
			break;
		    } catch(e)
		    {
			Components.utils.reportError('Error saving pref: '+name+' = '+value);
			Components.utils.reportError(e);
		    }
		}
            
            // There are int prefs, but for compatibility reasons, do not use them
            
            default:
                this.PREFS.setCharPref(name, value);
                break;
        }	
    },
    
    isSet : function(name)
    {
	return this.PREFS.prefHasUserValue(name);	
    },
    
    setIfDoesNotExist : function(name, value)
    {
	if (!this.isSet(name))
	{
	    this.set(name, value);
	}
	
    },
    
    rename : function(oldName, newName) {
        this.set(newName, this.get(oldName));
        this.remove(op);
    },
    
    remove : function(name)
    {
        if (this.isSet(name))
        {
	    this.set(name, '');
            return this.PREFS.clearUserPref(name);
        }       
    },
    
    append : function(name, value)
    {
        return this.PREFS.setCharPref(name, this.get(name) + value);	
    },
    
    
    // Get
    
    get : function(name) {
        if (this.isSet(name)) return this.PREFS.getCharPref(name);
    },
    
    getBool : function(name)
    {
        if (this.isSet(name)) {
	    try {
		return this.PREFS.getBoolPref(name);
	    } catch(e) {
		return this.PREFS.getCharPref(name) == 'true' ? true : false;
	    }
	    
	}
    },
    
    loadDefaults : function()
    {		
	    var firstRun = !this.isSet('version');
        
	//Installation		
	this.setIfDoesNotExist("installed",		(this.isSet('version')) );
	this.setIfDoesNotExist("version", 		'');
	this.setIfDoesNotExist("toolbar-btn-added",	false);
	this.setIfDoesNotExist("install-version",	'0');
	if (firstRun)
		this.setIfDoesNotExist("startedWithPocket",	true);
		    
	
	//Reading/Saving
	this.setIfDoesNotExist("read", 		'list');
	this.setIfDoesNotExist("mark", 		'null');
	this.setIfDoesNotExist("open", 		'current');	
	this.setIfDoesNotExist("autoMark",	false);
	this.setIfDoesNotExist("autoCloseTab",	false);
		    
	
	//Appearance
	this.setIfDoesNotExist("context-menu",		true);		
	this.setIfDoesNotExist("list-view",		'normal');
	this.setIfDoesNotExist("list-place",		'btn');
	this.setIfDoesNotExist("list-type",		'pages');		
	this.setIfDoesNotExist("list-page",		9);
	this.setIfDoesNotExist("default-sort", 	        0);		
	this.setIfDoesNotExist("show-count",		false);
	this.setIfDoesNotExist("show-date",		false);
	this.setIfDoesNotExist("force-styles",		true);
	this.setIfDoesNotExist("showStatusIconText",	'item');
	this.setIfDoesNotExist("showStatusIconShare",	'item');
	this.setIfDoesNotExist("showStatusIconClick",	'hide');
	
		    
	
	//Keystrokes
	this.setIfDoesNotExist("hotkey_toggle",	        'alt||W');
	this.setIfDoesNotExist("hotkey_push",		'alt||P');
	this.setIfDoesNotExist("hotkey_open_list",	'alt||Q');	
	this.setIfDoesNotExist("hotkey_click_mode",	'alt||M');	
	this.setIfDoesNotExist("hotkey_sidebar",	'alt||[');
	this.setIfDoesNotExist("hotkey_gr",		'i');
		    
	
	//Syncing
	this.setIfDoesNotExist("ana",		        !firstRun);
	this.setIfDoesNotExist("since",		        '0');
	this.setIfDoesNotExist("autoSync",	        true);
        this.setIfDoesNotExist('storeSecurely',         true);
        this.setIfDoesNotExist('promptedAboutMasterPass',false);
        
	
	//Text
	this.setIfDoesNotExist("text-options", 	JSON.stringify({
			    L:	0,
			    S:	1,
			    F:	1,
			    M:	1,
			    A:	1
			}));
		    
	
	//Google Reader	
	this.setIfDoesNotExist("integrate-gr",	true);
	
		    
	
	//Prompt Windows		
	this.setIfDoesNotExist("prompt_clear_offline",true);
	
	
	//Offline
	this.setIfDoesNotExist('getOfflineWeb', true);            
	this.setIfDoesNotExist('getOfflineText', false);
	this.setIfDoesNotExist("autoOffline",	false);
        
    }
  
  
  
};


/**
* XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4).
* XPCOMUtils.generateNSGetModule is for Mozilla 1.9.2 (Firefox 3.6).
*/
if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([RILprefs]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([RILprefs]);

