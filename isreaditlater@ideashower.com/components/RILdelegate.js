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


function RILdelegate()
{
    this.wrappedJSObject = this;
    
    this.v = '3.0.6';
    this.upgraded2Url = 'http://getpocket.com/upgraded/'; //changelog address
    this.upgradedUrl = 'http://getpocket.com/firefox/upgraded/'; //changelog address
    this.installedUrl = 'http://getpocket.com/installed/'; //installed address
    
    this.databaseName = 'readItLater.sqlite';
    
    // time in MILLISECONDS
    this.timeToAllowLinkResolverBeforeSavingLink = 15 	* 1000;
    this.timeToWaitBeforeFlushingScrollPositions = 2 	* 1000;
    
    // time in SECONDS
    this.idleTimeAutoSyncTrigger = 3 * 60 * 60; // modifying this may cause rate limit issues for your account, please be careful
        
    this.numberOfMostUsedTags = 4;
    
    this.loginInfo = {
	hostname: 'chrome://isreaditlater',
	formSubmitURL: null,
	httprealm: 'Account login'
    };
    
    this.errorPackages = {};
    this.checkedFavIcons = [];
    this.debugLog = '';
    
    //
    this.channels = {};
    
}

// class definition
RILdelegate.prototype = {

    // properties required for XPCOM registration:
    classDescription: "Pocket App Delegate Javascript XPCOM Component",
    classID:          Components.ID("{66030586-A638-11DF-ABFA-E67CDFD72085}"),
    contractID:       "@ril.ideashower.com/rildelegate;1",
    
    QueryInterface: XPCOMUtils.generateQI(),
    
    //////////////////////////////////////////////////
    
   
    
    init : function()
    {
	
	if (!this.inited)
	{
	    // -- Loading and Starting -- //
	    this.connectToCoreServices();	    
	
	    // Connect to db
	    this.DB = this.connectToDatabase(this.databaseName);
	    
	    // -- Installing and Upgrading -- //
	    this.install();
	    
	    // Grab list
	    this.LIST.fetch();              
	    
	    // Add idle auto-sync
	    this.IDLE.addIdleObserver(this.autoSyncIdleObserver, this.idleTimeAutoSyncTrigger);	    
	    
	    this.inited = true;
	    
	    this.definePrototypes();
	}
        
    },
    
    connectToCoreServices : function() {
            
        Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
        
        // Firefox        
        this.PROMPT = Components
                .classes["@mozilla.org/embedcomp/prompt-service;1"]
                .getService(Components.interfaces.nsIPromptService);
        this.JSON = Components.classes["@mozilla.org/dom/json;1"]
                .createInstance(Components.interfaces.nsIJSON);
        
        this.STORAGE = Components.classes["@mozilla.org/storage/service;1"]
                .getService(Components.interfaces.mozIStorageService);
        
        this.OBSERVER = Components.classes["@mozilla.org/observer-service;1"]
                .getService(Components.interfaces.nsIObserverService);
		
	this.IO = Components.classes["@mozilla.org/network/io-service;1"]
		.getService(Components.interfaces.nsIIOService);
                
	this.ICO = Components
		.classes["@mozilla.org/browser/favicon-service;1"]
		.getService(Components.interfaces.nsIFaviconService);
		
	this.LOGIN = Components.classes["@mozilla.org/login-manager;1"]
                    .getService(Components.interfaces.nsILoginManager);
		    
	this.IDLE = Components.classes["@mozilla.org/widget/idleservice;1"]
				    .getService(Components.interfaces.nsIIdleService)
                
        // Pocket
        this.PREFS = Components.classes['@ril.ideashower.com/rilprefs;1'].getService().wrappedJSObject;
        
        this.LIST = Components.classes['@ril.ideashower.com/rillist;1'].getService().wrappedJSObject;
        this.LIST.init();
        
        this.SYNC = Components.classes['@ril.ideashower.com/rilsync;1'].getService().wrappedJSObject;
        this.SYNC.init();
        
        this.ASSETS = Components.classes['@ril.ideashower.com/rilassetmanager;1'].createInstance(Components.interfaces.nsIRILassetManager);       
        this.ASSETS.init();
        
        this.OFFLINE = Components.classes['@ril.ideashower.com/rilofflinequeue;1'].getService().wrappedJSObject;
	this.OFFLINE.init();  
    },
    
    
    // -- Database Connections -- //
    
    connectToDatabase : function(databaseName) {
        
        var file = Components.classes["@mozilla.org/file/directory_service;1"]
                        .getService(Components.interfaces.nsIProperties)
                        .get("ProfD", Components.interfaces.nsIFile);
        file.append(databaseName);
	    
        return this.STORAGE.openDatabase(file);
    },
    
    createTables : function() {

	if (!this.DB.tableExists('items'))
	{
	    this.DB.executeSimpleSQL("CREATE TABLE items (item_id INTEGER NOT NULL , unique_id INTEGER NOT NULL, url VARCHAR NOT NULL , title VARCHAR NOT NULL , time_updated INTEGER NOT NULL , offline_web INTEGER NOT NULL , offline_text INTEGER NOT NULL, percent INTEGER NOT NULL  )");
	    this.DB.executeSimpleSQL("CREATE INDEX item_idIndex ON items ( item_id )");
	    this.DB.executeSimpleSQL("CREATE UNIQUE INDEX url ON items ( url )");
	    this.DB.executeSimpleSQL("CREATE INDEX time_updated ON items ( time_updated )");
	    this.DB.executeSimpleSQL("CREATE INDEX percent ON items ( percent )");
	}
	
	if (!this.DB.tableExists('tags'))
	{
	    this.DB.executeSimpleSQL("CREATE TABLE tags (item_id INTEGER NOT NULL , tag VARCHAR NOT NULL , PRIMARY KEY (item_id, tag))");
	}
	
	if (!this.DB.tableExists('scroll'))
	{
	    this.DB.executeSimpleSQL("CREATE TABLE scroll (item_id INTEGER NOT NULL, view INTEGER NOT NULL, section INTEGER NOT NULL, page INTEGER NOT NULL, node_index INTEGER NOT NULL, percent INTEGER NOT NULL, time_updated INTEGER NOT NULL, PRIMARY KEY (item_id, view))");
	}
	
	if (!this.DB.tableExists('resolver'))
	{
	    this.DB.executeSimpleSQL("CREATE TABLE resolver (item_id INTEGER NOT NULL , url VARCHAR)");
	}
	
	if (!this.DB.tableExists('sync_queue'))
	{
	    this.DB.executeSimpleSQL("CREATE TABLE sync_queue (type VARCHAR NOT NULL, url VARCHAR NOT NULL, PRIMARY KEY(url, type))");
	}
	
	if (!this.DB.tableExists('assets'))
	{
	    this.DB.executeSimpleSQL("CREATE TABLE assets (asset_domain VARCHAR NOT NULL)");
	}
	
	if (!this.DB.tableExists('assets_items'))
	{
	    this.DB.executeSimpleSQL("CREATE TABLE assets_items (asset_domain VARCHAR NOT NULL , item_id INTEGER NOT NULL , PRIMARY KEY (asset_domain, item_id))");	    
	    this.DB.executeSimpleSQL("CREATE INDEX item_id_lookup ON assets_items ( item_id )");
	}
	
	if (!this.DB.tableExists('vars'))
	{
	    this.DB.executeSimpleSQL("CREATE TABLE vars (unique_id INTEGER NOT NULL)");
	    this.DB.executeSimpleSQL("INSERT INTO vars (unique_id) VALUES (0)");
	}

    },
    
    dumpAndReinstallDatabase : function()
    {
	// Drop all tables - ideally we'd just remove the file but this.DB.close() results in an error, so we do it the long way
	var sql = "select name from sqlite_master where type = 'table'";
	var statement = this.DB.createStatement(sql);
	var dropStatment;
	var drops = [];
	try {                    
	    while (statement.step())
	    {		
		dropStatement = "DROP TABLE " + statement.row.name;
		drops.push(dropStatement);
	    } 
	} catch(e) {
	    Components.utils.reportError(e);   
	}	
	finally {
	    statement.reset();
	}
	
	// Clear space
	this.DB.executeSimpleSQL("VACUUM");
	
	// drop
	for(var i=0; i<drops.length; i++)
	{
	    this.DB.executeSimpleSQL(drops[i]);
	}

	this.createTables();
    },
    
    
    // -- Install / Upgrades -- //
    
    install : function() {        
        
	this.PREFS.loadDefaults();
        this.createTables();
	
	
	// -- Upgrades
	
	var justInstalled = false;
        var shouldTouch = false;
	
	// -- If First Run -- //
	if (!this.PREFS.getBool('installed')) {
	    
	    //Set this version as original install point
	    this.PREFS.set('install-version', this.v);
	    
	    //Set as installed
	    this.PREFS.set('installed', true);
	    
	    justInstalled=true;
	}
	
	// --- Check Version and show Changelog on update --- //
	if (this.PREFS.get('version') != this.v) {
	    if (justInstalled)
            {
                this.openLoginWhenStarted = true;	
	    } else
            {
                if (this.PREFS.get('version') < '2.0.1')
                    this.setTimeout(function(){this.openUrl(this.upgraded2Url, {targ:'tab',ig:true});}, 750);
                else
                    this.justUpgraded = true;
                    
                if (this.PREFS.get('version').match('2.0'))
                    shouldTouch = true;
                    
	    }
	    this.PREFS.set('version', this.v);
	}
        
        if (shouldTouch && this.SYNC.syncingEnabled())
            this.SYNC.touch();        
    },
    
    upgraded : function()
    {
        try
        {
            this.justUpgraded = false;
            
            var n = this.LIST.list.length;
            var t = this.LIST.tags.length;
            var l = 0;
            try{
                l = this.getLogin() ? 1 : 0;
            }
            catch(e){}
            
            this.openUrl(this.upgradedUrl + '?v='+this.v+'&n='+n+'&t='+t+'&l='+l, {targ:'tab',ig:true});
            
        }
        catch(e)
        {
            this.openUrl(this.upgradedUrl, {targ:'tab',ig:true});   
	    Components.utils.reportError( e );         
        }
    },    
    
    
    
    // -- Fetching List -- //
    
    listHasBeenReloaded : function(success)
    {
	
	if (!this.listHasBeenLoadedOnce)
	{
	    this.listHasBeenLoadedOnce = true;
	    this.upgradeFromBeta();
	}
	
	if (!this.hasSyncedAtStartup)
	{
	    this.hasSyncedAtStartup = true;
	    if (!this.startupError && !this.listError && this.PREFS.getBool('autoSync') && this.SYNC.syncingEnabled())
            {
		    this.SYNC.sync();
            }
	}
	 
        this.commandInAllOpenWindows('RIL', 'checkPage', null, true);         
        this.refreshListInAllOpenWindows();
	
    },
    
    filterList : function(typeOfList, filter, delegate)
    {
	if (!this.LIST || !this.LIST.list) return false;
	
	// Determine which list to use as base
	var listSource;
	switch(typeOfList)
        {
	    case('current'):
		this.LIST.getCurrentList();
		listSource = this.LIST.currentList;
		break;
	    case('read'):
                // should never get right here??
                listSource = [];
		break;
	    case('tags'):
		this.LIST.rebuildTagIndex();
		if (delegate.selectedTag)
		{
		    if (this.LIST.tagItemIndex[delegate.selectedTag])
		    {
		        listSource = this.LIST.tagItemIndex[delegate.selectedTag];
			break;
		    } else {
			delegate.selectedTag = null;
		    }
		}
		// fall through to default
	    default:
		listSource = this.LIST.list;
		break;
	}
        
        // Anything to filter out?
        var filteredList = [];
        if (filter) {
        
            var item, i=0;
            var filterCaseIns = new RegExp(this.regexSafe(filter), 'i');
            var tagFilter = new RegExp(this.regexSafe(filter)+'([^,]+)?($|,)', 'i');
            
	    var c=0;
            for( var i in listSource ) {
 
                item = listSource[i];
		
		// Currently reading filter
		if (typeOfList == 'current' && !item.percent) continue;
		
                if (item.title.match( filterCaseIns ) ||
                    item.url.match( filterCaseIns ) ||
                    (item.tagList && item.tagList.match( tagFilter ))
                    )
                {
		    filteredList[ c ] = item;
		    c++;
                }
            }
            
        } else {
            filteredList = listSource ? listSource.slice() : null; // make a copy of the object
        }
	
	return filteredList;
    
    },
    
    sortList : function(listSource, sortValue)
    {
	
	if (!listSource) return;
	
        switch( sortValue ) {
            case('2'): //Oldest
                this.sortFunction = this.sortByDate;
                this.sortDirection = -1;
                break;
            case('3'): //Title
                this.sortFunction = this.sortByTitle;
                this.sortDirection = 1;
                break;
            case('4'): //Url
                this.sortFunction = this.sortByUrl;
                this.sortDirection = 1;
                break;
            default: //Newest // should update offline queue component's version of this as well
                this.sortFunction = this.sortByDate;
                this.sortDirection = 1;
                break;
        }
        
        var selfOBJECT = this;
        listSource.sort( function(a,b){ return selfOBJECT.sortFunction(a,b) } );
        
        return listSource;
        
    },
    
    sortByDate : function(a,b) { // should update offline queue component's version of this as well
        var r = a.timeUpdated < b.timeUpdated ? 1 : (a.timeUpdated > b.timeUpdated ? -1 : 0);
        return r * this.sortDirection;
    },
    
    sortByTitle : function(a,b) {
        var r = a.title < b.title ? -1 : (a.title > b.title ? 1 : 0);
        return r * this.sortDirection;
    },
    
    sortByUrl : function(a,b)
    {
        if (!a.urlP)
            a.urlP = a.url.replace('www.','');
        if (!b.urlP)
            b.urlP = b.url.replace('www.','');
        
        var r = a.url < b.url ? -1 : (a.url > b.url ? 1 : 0);
        return r * this.sortDirection;
    },
    
    
    
    
    // -- Displaying List -- //    
        
    refreshRowInAllOpenWindows : function(itemId) {
	this.commandInAllOpenWindows('RIL', 'refreshRow', itemId);
    },
    
    refreshTagRowInAllOpenWindows : function(tags) {
	this.commandInAllOpenWindows('RIL', 'refreshTagRow', tags);
    },
    
    refreshListInAllOpenWindows : function(onlyForType) {
	this.commandInAllOpenWindows('RIL', 'refreshList', onlyForType);
    },    
    
    updateUnreadCount : function() {
        this.commandInAllOpenWindows('RIL', 'updateUnreadCount');
    },
    
    
    
    // -- FavIcons -- //
    
    fetchFavIconForItem : function(item, nsiuri)
    {
	// Get a NSIURI
	if (!nsiuri)
	    nsiuri = this.uri(item.url);
	
	// Check if we've already looked
	var favUrl = nsiuri.scheme+'://'+nsiuri.host+'/favicon.ico';
	if (this.checkedFavIcons[ favUrl ]) return false;
	this.checkedFavIcons[ favUrl ] = true;
	
	// Get the history service and register the observer if we haven't already
	try {
	    if (!this.HISTORY)
		this.HISTORY = Components.classes["@mozilla.org/browser/nav-history-service;1"].getService(Components.interfaces.nsINavHistoryService);
	    
	    if (!this.historyObserverAdded)
	    {
		// Observer is removed in uninit and also after a set amount of time in populateList method
		this.HISTORY.addObserver( this.historyObserver, false);
		this.historyObserver.self = this;
		this.historyObserverAdded = true;
	    }
	} catch(e) { Components.utils.reportError(e); }
	
	if (this.ICO.setAndFetchFaviconForPage)
		this.ICO.setAndFetchFaviconForPage(nsiuri, this.uri(favUrl), false, this.ICO.FAVICON_LOAD_NON_PRIVATE);
	else
		this.ICO.setAndLoadFaviconForPage(nsiuri, this.uri(favUrl), false, this.ICO.FAVICON_LOAD_NON_PRIVATE);
    },
    
    favIconUpdated : function(aURI, theItem)
    {
		var item = theItem && theItem.itemId ? theItem : this.LIST.itemByUrl(aURI.spec);
		
		if (item)
		{
			if (aURI)
			    this.fiCache[item.itemId] = aURI.spec;
		    this.refreshRowInAllOpenWindows(item.itemId);
		}
    },
    
    // History observer
    
    historyObserver : {
	onPageChanged: function(aURI, aWhat, aValue) {
	    if (aWhat == 3 && aValue.match('.ico'))
		this.self.favIconUpdated(aURI)
	},
        
        
        // ----- not using these but they have to be defined:        
	onBeginUpdateBatch: function() {},
	onEndUpdateBatch: function() {},
	onVisit: function(aURI, aVisitID, aTime, aSessionID, aReferringID,aTransitionType) {},
	onTitleChanged: function(aURI, aPageTitle) {},
	onDeleteURI: function(aURI) {},
	onClearHistory: function() {},
	onPageExpired: function(aURI, aVisitTime, aWholeEntry) {},
	QueryInterface: function(iid) {
	    if (iid.equals(Components.interfaces.nsINavHistoryObserver) || iid.equals(Components.interfaces.nsISupports)) {
		return this;
	    }
	    throw Cr.NS_ERROR_NO_INTERFACE;
	}
        //-----
    },
    
    removeHistoryObserver : function()
    {
	if (this.historyObserverAdded && this.HISTORY)
	    this.HISTORY.removeObserver(this.historyObserver, false);
	this.historyObserverAdded = false;
        this.d('REMOVED HISTORY OBSERVER');
    },



    // -- Logins -- //
    
    hasMasterPassword : function()
    {
        try
        {
            var tokendb = Components.classes["@mozilla.org/security/pk11tokendb;1"]
                        .createInstance(Components.interfaces.nsIPK11TokenDB);
            var token = tokendb.getInternalKeyToken();
            
            return token.needsLogin() && !token.isLoggedIn();
        }catch(e){}
    },
    
    showLoginPromptIfNeeded : function()
    {
    	if (!this.PREFS.getBool('ana') && !this.getLogin())
    	{
    		this.commandInTopRIL('openLogin');
    		return false;
    	}
    	
    	return true;
    },
    
    getLogin : function()
    {
        if (this.PREFS.getBool('loggedOut')) return;
        
        var storeSecurely = this.PREFS.getBool('storeSecurely');
        var hasMasterPassword = this.hasMasterPassword();
        var promptedAboutMasterPass = this.PREFS.getBool('promptedAboutMasterPass');
        
        if (storeSecurely && hasMasterPassword && !promptedAboutMasterPass)
        {
            var check = {value:false};
            this.PROMPT.alertCheck( this.getMainWindow(), "Master Passwords and Pocket",
                                    "Pocket stores your username and password securely in Firefox's password manager. If you have a master password enabled this means you will be prompted every time RIL auto-syncs.  You can disable this under the advanced options by opting to disable storing your RIL account login securely.",
                                    "Do not tell me again",
                                    check);
            if (check.value)
            {
                this.PREFS.set('promptedAboutMasterPass', true);
            }
        }
        
        if (storeSecurely)
        {   
            // Find users for the given parameters
            var logins = this.LOGIN.findLogins({}, this.loginInfo.hostname, this.loginInfo.formSubmitURL, this.loginInfo.httprealm);
            return logins[0]; // only storing one, so just return the first
        }
        
        else
        {
            var username = this.PREFS.get('username');
            var password = this.PREFS.get('password');
            
            if (!username || !password) return;
            
            var nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1",
								 Components.interfaces.nsILoginInfo,
								 "init");
	
            return new nsLoginInfo(this.loginInfo.hostname,
                                                    this.loginInfo.formSubmitURL, this.loginInfo.httprealm,
                                                    username,
                                                    password, "", "");
            
        }
    },
		
    saveLogin : function(username, password)
    {		
        this.PREFS.set('loggedOut', false);
        this.justLoggedInAndWaitingToSync = true;
	
	// Remove login if it exists
	var currentLogin = this.getLogin();
	if (currentLogin)
		this.LOGIN.removeLogin(currentLogin);
	
	// Save Login
	var nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1",
								 Components.interfaces.nsILoginInfo,
								 "init");
	
        if (this.PREFS.getBool('storeSecurely'))
        {
            var loginInfo = new nsLoginInfo(this.loginInfo.hostname,
                                                    this.loginInfo.formSubmitURL, this.loginInfo.httprealm,
                                                    username,
                                                    password, "", "");        
            this.LOGIN.addLogin(loginInfo);
            
	    this.removePrefLogin();
            
        }
        
        else
        {
            this.PREFS.set('username', username);
            this.PREFS.set('password', password);
        }
    },
    
    logout : function(quiet)
    {        
	var login = this.getLogin();
	if (login)
	{
            if (this.PREFS.getBool('storeSecurely'))
                this.LOGIN.removeLogin(login);
            else
                this.removePrefLogin();
	}
        
        this.PREFS.set('loggedOut', true);
        
        this.clearLocalData();
        
        this.PREFS.set('ana', false);
	
	if (!quiet)
	    this.PROMPT.alert(this.getMainWindow(true), 'Pocket', 'You have been logged out.  Changes to your reading list will no longer be synced.');
    },
    
    removePrefLogin : function()
    {
        // Remove passwords from prefs
	this.PREFS.remove('username');
	this.PREFS.remove('password');
    },
    
    relogin : function()
    {
	this.commandInTopRIL('relogin');
    },
    
    clearLocalData : function()
    {
	    // reinstall ril database
	    this.dumpAndReinstallDatabase();
	    
	    // clear in memory list
	    this.LIST.fetch();
	    
	    // clear last get
	    this.PREFS.set('since', 0);
    },
    
    // -- //
    
   
    autoSyncIdleObserver : {
	observe: function(subject, topic, data) {
	    if (topic == 'idle')
	    {
		this.isIdle = true;
	    } else if (topic == 'back' && this.isIdle)
	    {
		this.syncWhenListIsOpened = true;
	    }
	}
    },
    
    observe: function(subject, topic, data)
    {        
        switch(topic)
        {
            case('ril-api-request-finished'):
                this.SYNC.requestCallback(subject, data);
                break;
        }
    },
    
    
    // -- Offline -- //    
    
    updateDownloadProgress : function(pointer, size)
    {
	this.commandInAllOpenWindows('RIL', 'updateDownloadProgress', [pointer,size], true);
    },
   	
    
    // -- Link Resolving -- //
    
    resolveLink : function(itemId, url, callback)
    {
	var listener = new this.listenerResolver(itemId, url, this, 'resolveLinkCallback', this);
	listener.start();	
    },
    
    resolveLinkCallback : function(itemId, url, newUrl)
    {
	var item = this.LIST.itemById(itemId);
	if (!item) return; //if item was removed during the resolving
	
	if (url != newUrl)
	{	    
	    // URL has changed
	    this.LIST.changeURL( itemId, newUrl );
	}
    },
    
    listenerResolver : function(itemId, url, delegate, selector, APP) {
	this.itemId = itemId;
	this.url = url;
	this.delegate = delegate;
	this.selector = selector;
	this.APP = APP;
    }, //-- prototype defined below -- //
        
    definePrototypes : function()
    {	
	this.listenerResolver.prototype =
	{
	    start : function()
	    {
		// Open connection to resolve the link
		var request = this.request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);  
		request.open("GET", this.url, true);        
		request.onreadystatechange = this.APP.genericClosure(this, 'onreadystate');
		request.send();
	    },
	    
	    onreadystate : function(e)
	    {
		if (this.request.readyState >= 2 && !this.finished)
		{
		    this.finish();
		}		
	    },
	    
	    finish : function()
	    {
		this.finished = true;
		this.delegate[this.selector].call( this.delegate, this.itemId, this.url, this.request.channel.URI.spec );
	    }
	};
    },
    
    
    // --  Observers -- //
	
    registerObserver : function(topic, delegate) {
	this.OBSERVER.addObserver(delegate ? delegate : this, topic, false);
    },
    unregisterObserver : function(topic, delegate) {
	this.OBSERVER.removeObserver(delegate ? delegate : this, topic);
    },
    
    
    // -- Offline -- //
    
    offlinePathHasChanged : function()
    {
	this.ASSETS.init();
    },
    
    updateOfflineQueue : function(newItems)
    {
	var item;
	for(var i in newItems)
	{
	    item = this.LIST.itemById(newItems[i]);
	    if (item)
		this.OFFLINE.addItemToQueue(item, null, true);
	}
    },
    
    
    // -- Helpers -- //  
    
    commandInAllOpenWindows : function(objectName, methodName, argument, notInSidebar, any) {
	
	var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]  
			   .getService(Components.interfaces.nsIWindowMediator);  
	var enumerator = wm.getEnumerator( any ? null : 'navigator:browser');  
	while(enumerator.hasMoreElements())
        {  
	    var win = enumerator.getNext();
	    if (win[objectName])
            {
		
                if (objectName == 'RIL' && !win[objectName].APP) return;
                
		
		// Update row in window (dropdown)
		win[objectName][methodName](argument);
		
		// Update row in sidebar
		if (!notInSidebar && objectName == 'RIL' && win[objectName].xulId('sidebar', true) &&
		    win[objectName].xulId('sidebar', true).contentWindow[objectName])
                {
			win[objectName].xulId('sidebar', true).contentWindow[objectName][methodName](argument);
		}
	    }
	}
    },
    
    commandInMainWindow : function(objectName, methodName, arg1, arg2, arg3, arg4, arg5, arg6)
    {
        var mainWindow = this.getMainWindow();
        if (mainWindow && mainWindow[objectName])
            mainWindow[objectName][methodName](arg1, arg2, arg3, arg4, arg5, arg6);        
    },
    
    commandInTopRIL : function(methodName, arg1, arg2, arg3, arg4, arg5, arg6)
    {
        var mainWindow = this.getMainWindow();
        
	if (mainWindow && mainWindow.RIL && mainWindow.RIL.APP && mainWindow.RIL.APP.inited)
	{
	    var topRIL = mainWindow.RIL.getPriorityRIL();
	    if (topRIL)
            {
		topRIL[methodName](arg1, arg2, arg3, arg4, arg5, arg6);
            }
             
	}
    },
    
    
    // -- Delegate to the main window functions -- //
    
    openUrl : function(url, o) {
	this.commandInMainWindow( 'RIL' , 'openUrl', url, o);
    },
    
    openUrlAndCloseList : function(url, o){
	this.commandInMainWindow( 'RIL' , 'openUrl', url, o);
	this.commandInMainWindow( 'RIL' , 'closeReadingList');
    },
    
    openSitePage : function(page, login)
    {	
	var url = 'http://getpocket.com/';
	var currentLogin = this.getLogin();
	var postData;
	
	if (login && currentLogin)
	{
	    var params = 'username='+this.e(currentLogin.username)+'&password='+this.e(currentLogin.password);

	    url += 'goto?page='+page;
	    
	    var stringStream = Components.classes["@mozilla.org/io/string-input-stream;1"].createInstance(Components.interfaces.nsIStringInputStream);
	    
	    if ("data" in stringStream) // Gecko 1.9 or newer
		stringStream.data = params;
	    else // 1.8 or older
		stringStream.setData(params, params.length);
	    
	    postData = Components.classes["@mozilla.org/network/mime-input-stream;1"].createInstance(Components.interfaces.nsIMIMEInputStream);
	    postData.addHeader("Content-Type", "application/x-www-form-urlencoded");
	    postData.addContentLength = true;
	    postData.setData(stringStream);

	}	
	else
	{
	    url += page;    
	}
	
	/*this.getMainWindow().openDialog(url, '_blank', 'all,dialog=no,chrome=no',
                null, null, null, postData);*/
	
	// Not ideal, would rather open this in a new window
	var mainWindow = this.getMainWindow();
	var gBrowser = mainWindow.getBrowser();
	gBrowser.selectedTab = gBrowser.addTab(url, null, null, postData )
	mainWindow.focus( );

	
    },
    
    genericMessage : function(msg, buttons, openWindow, chooserValue, persist, inPlaceOfList)
    {
	this.commandInTopRIL( 'genericMessage', msg, buttons, openWindow, chooserValue, persist, inPlaceOfList);
    },
    
    
    
    // -- Document Helpers -- //    
    
    getMainWindow : function(any)
    {
	var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]  
                        .getService(Components.interfaces.nsIWindowMediator);  
        return wm.getMostRecentWindow( any ? null : "navigator:browser"); 
    },
    
    getTopRIL : function()
    {
	return this.getMainWindow().RIL;
    },
    
    getWebWorker : function(script)
    {
        var RIL = this.getTopRIL();
        return RIL.getWebWorker(script);
    },
    
    setTimeout : function(func, time, that, interval, timer)
    {
        that = that ? that : this;
        var callback = {that:that, notify:function(){func.call(this.that)}};
        
        var timer = timer ? timer : Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
        timer.initWithCallback(callback, time, interval ? Components.interfaces.nsITimer.TYPE_REPEATING_SLACK : Components.interfaces.nsITimer.TYPE_ONE_SHOT);
        return timer;
    },
    
    setInterval : function(func, time, that)
    {
        return this.setTimeout(func, time, that, true);
    },
    
    clearTimeout : function(timer)
    {
        if (timer)
	{
	    timer.cancel();
	    return timer;
	}
    },
    
    
    // -- Helpers -- //    
      
    stripTags : function(str){
	return str.replace(/<\/?[^>]+>/gi, '');		
    },
    
    e : function(str) {
            return encodeURIComponent(str);
    },
    et : function(title) {
            return this.e(title.replace(/"/g,'&quot;').replace(/\\/g,'-'));
    },
    
    uri : function(uri) {
	return this.IO.newURI(uri, null, null);
    },
    
    checkIfValidUrl : function(url, alert)
    {
	var valid = true;	
	
	if (url.length > 1000 || url.match(/^data:.*;base64/))
	    valid = false; // data, will cause freeze if it has to be parsed
	
	if (valid)
	{
	    var parsed = this.parseUri(url);
	    if (parsed.protocol == 'http' || parsed.protocol == 'https') {
		return true;
	    }
	}
	
	//else
	if (alert) {
	    this.PROMPT.alert(this.getMainWindow(), 'Pocket', this.getTopRIL().l('OnlyWebsites') );
	    return false;
	}
    },
    
    parseUrl : function(url, forLookup, noCheckOnFail) { 
	if (url) {
            if (url.length > 1250) return; //too long of a url locks browser in parseUri script
            
	    try {
		/**********
		Updates to this logic need to be updated in the parse url server side function
		***********/
		
		//forLookup - remove anchor (unless it has slashes) - decodeURI
		
		var parsed = this.parseUri( forLookup ? decodeURI(url) : url );
		
		parsed.host = parsed.host.toLowerCase().replace('www.', ''); //remove www. and make domain lowercase
		parsed.path = parsed.path.replace(new RegExp('/$'), '');  //remove trailing slash
		
                // We only use the fragment if:
		// 1. Not forLookup
		// 2. If forLookup and the fragment starts with '/', assuming it is meant to be part of the path
                anchorPart = parsed.anchor && (!forLookup || parsed.anchor.match(/\//)) ? ('#'+parsed.anchor) : ''; 
                
		return parsed.protocol + '://' + parsed.host + parsed.path + parsed.query + anchorPart;
	    } catch(e)
	    {
		Components.utils.reportError(e);
		Components.utils.reportError('url from previous error: ' + url);
		
		if (url.length > 250 && !noCheckOnFail)
		{
		    // might have been truncated, look to see if it ends in a broken %XX encoding
		    var regex = /%[0-9]{0,1}$/;
		    if (url.match(regex))
			return this.parseUrl(url.replace(regex,''), forLookup, true);
		}
				
	    }
	}
    },
    
    parseUri : function(urlStr, baseURL) // update this in ASSET MANAGER as well
    {
	if (baseURL && !urlStr.match(/^https?:/))
	{
	    // convert urlStr into a full absolute url
	    var parsedBase = this.parseUri(baseURL);
	    var baseRoot = parsedBase.protocol + '://' + parsedBase.authority + '/';
	    
	    if ( urlStr.match(/^\.\.?\//) ) // ../../format.html
	    {
		var relativeBaseParts = parsedBase.relative.split('/');
		if (relativeBaseParts.length < 3)
		{
		    urlStr = baseRoot + urlStr.replace(/^(\.\.\/){0,}/,'')
		}
		else
		{
		    relativeBaseParts.shift(); //remove first which will be empty  (x)/something/something/
		    if (parsedBase.file || relativeBaseParts[relativeBaseParts.length-1].length==0) relativeBaseParts.pop(); //remove end (file)
		    
		    var end = relativeBaseParts.length - urlStr.match(/\.\.\//g).length;
		    var rel = relativeBaseParts.slice(0,end>0?end:0).join('/');
		    urlStr = baseRoot + (rel ? rel+'/' : '') + urlStr.replace(/^(\.\.\/){0,}/,''); 		    
		}
		
	    }
	    
	    else if (urlStr.match(/^\//)) // /format.html
	    {
		urlStr = baseRoot.replace(/\/$/,'') + urlStr;
	    }
	    
	    else
	    { // format/format.html
		urlStr = baseRoot.replace(/\/$/,'') + parsedBase.directory.replace(/[^\/]*$/,'') + urlStr;
	    }
	    
	}
	
        var o = {
            strictMode: false,
            key: ["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"],
            q:   {
                name:   "queryKey",
                parser: /(?:^|&)([^&=]*)=?([^&]*)/g
            },
            parser: {
                strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*):?([^:@]*))?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
                loose:  /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*):?([^:@]*))?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
            }
        }
        
        var m	= o.parser[o.strictMode ? "strict" : "loose"].exec(urlStr),
            uri = {},
            i   = 14;
        
        while (i--) uri[o.key[i]] = m[i] || "";
        
        uri[o.q.name] = {};
        uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
            if ($1) uri[o.q.name][$1] = $2;
        });
        
	uri.spec = urlStr;
	uri.scheme = uri.protocol;
	
        return uri;        
    },
    
    
    // debug
    
    tok   : /^(https?:\/\/(?:www\.)?amazon\.[a-z\-\.]*\/[^\?\n\r]*)(?:\?(.*))?/i, 
    now : function() {
	var d = new Date();
	return d.getTime()/1000;
    },
    ar : function(a){
	var str = '';
	for(var i in a){
	    str += i + ' : ' + ( typeof a[i] == 'object' ? this.ar(a[i], true) : a[i] ) + "\n";
	}
	return str;
    },
    dp : function(str)
    {
        if (this.debug)
            this.debugLog = str+" ||\n" + this.debugLog;                
    },
    d : function(str, lvl)
    {
        if (!lvl) lvl = 10;
        if (this.debug >= lvl)
            dump(str+"\n");
    },  
    
    // strings
    
    stripTags : function(str){
	return str.replace(/<\/?[^>]+>/gi, '');		
    },
    trim : function(str)
    {
	if (!str) return '';
        return str.trim();
    },
    trimLeft : function(str)
    {
        if (!str) return '';
	return str.trimLeft();
    },
    regexSafe : function(str)
    {
	return str.replace(/(\W)/g, '\\$1');	
    },    
    
    genericClosure : function(delegate, selector)
    {
	if (!delegate || !selector) return;
	var method = delegate[selector];
	function closure(a,b,c,d,e,f){ method.call(delegate,a,b,c,d,e,f); };
	return closure;
    },  
    
    genericDataClosure : function(delegate, selector, data)
    {
	if (!delegate || !selector) return;
	var method = delegate[selector];
        var dataVar = data;
	function closure(){ method.call(delegate,dataVar); };
	return closure;
    },
    
    
       
    /* --- Migrating from 0.9 to 2.0 --- */
    
    upgradeFromBeta : function()
    {	
	try {
	    
	    // Get folder id (old pref from pre 2.0)
	    var folderId = this.PREFS.get('folderId');
	    if (!folderId) return false; // no need to upgrade
	    
	    
	    // -- Handle old logins
	    
	    // cancel auto sync
	    this.hasSyncedAtStartup = true;
	    
	    // Open login dialog?
	    if (this.PREFS.getBool('feed') && this.PREFS.getBool('sync'))
	    {
		// User is already syncing, store current login details, do not present login dialog
		
		// get old details
		var username = this.PREFS.get('feed-id-'+this.PREFS.get('feed-which'));
		var password = this.PREFS.get('sync-'+this.PREFS.get('feed-which'));
		
		// save details
		if (username && password)
		    this.saveLogin(username, password);
		
	    }
	    
	    // Remove passwords from prefs
	    //this.PREFS.remove('sync-default');
	    //this.PREFS.remove('sync-alt');
            
            // Update old prefs
            try
            {
                this.PREFS.setIfDoesNotExist( 'autoCloseTab', this.PREFS.get('auto-close-tab') == 'true' );
                this.PREFS.set( 'autoCloseTab', this.PREFS.get('auto-close-tab') == 'true' );
                this.PREFS.set("list-type",	'pages');
            }
            catch(e)
            {}
	    
	    
	    // -- Transfer list from bookmarks into new database
	    
	    
	    // Retrieve link resolver
	    var resolver = {};
	    try
	    {		
		// Connect to old db
		var file = Components.classes["@mozilla.org/file/directory_service;1"]
                        .getService(Components.interfaces.nsIProperties)
                        .get("ProfD", Components.interfaces.nsIFile);
		file.append("ril.sqlite");	
		var db = this.STORAGE.openDatabase(file);
				
		// query old db and build resolver
		var sql = "SELECT id, original_url FROM ril_link_resolver"
		var statement = db.createStatement(sql);
		var id, url;
		while (statement.executeStep())
		{
		    id = statement.getInt32(0);
		    url = statement.getUTF8String(1);
			    
		    resolver[ id ] = url;
		}
		statement.reset();		
		
	    } catch(e) {
		Components.utils.reportError(e);
	    }
	    
	    
	    // Retreive old list and add to new system in batch mode
	    var sHistory =	Components
			    .classes["@mozilla.org/browser/nav-history-service;1"]
			    .getService(Components.interfaces.nsINavHistoryService);	    	
	    
		   
	    // Search Bookmarks 
	    var options = sHistory.getNewQueryOptions();
	    var query = sHistory.getNewQuery();
	    query.setFolders([folderId], 1);
		  
	    var listResult = sHistory.executeQuery(query, options);
    
	    var rootNode = listResult.root;
	    rootNode.containerOpen = true;	    

	    // Process Results
	    var PU = this.getMainWindow().PlacesUtils;
	    for (var i = 0; i < rootNode.childCount; i ++) {
		var node = rootNode.getChild(i);
		if (PU.nodeIsBookmark(node))
		{
		    var itemId, item;
		    
		    itemId = this.LIST.add({
			url: node.uri,
			title: node.title,
			timeUpdated: node.dateAdded / 1000 / 1000
		    }, true, true, true);
		    
		    if (node.tags)
			this.LIST.saveTags(itemId, node.tags, true, true);
			
		    
		    if (!itemId)
			item = this.LIST.itemByUrl(node.uri);
		    
		    if (resolver[node.itemId])
			this.LIST.addUrlToResolverForItemId(item ? item.itemId : itemId, resolver[node.itemId], false, true);
		}
		    
	    }
	    this.LIST.flushBatch();
    
	    // close a container after using it!
	    rootNode.containerOpen = false;
	    
	    
	    // upgraded successful, remove old folder id
	    this.PREFS.remove('folderId');
	    
	    // hard sync
            if (this.getLogin())
                this.SYNC.sync(true);
	    
	    return true;
	
	} catch(e) {
	    Components.utils.reportError(e);
	}
	
    }

};



/**
* XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4).
* XPCOMUtils.generateNSGetModule is for Mozilla 1.9.2 (Firefox 3.6).
*/
if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([RILdelegate]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([RILdelegate]);
