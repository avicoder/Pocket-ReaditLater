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

function RILsync()
{
    this.wrappedJSObject = this;
    
    this.batch = [];
    this.requests = {};
    
    this.waitBeforeSending 		= 2 * 1000;
    
}

// class definition
RILsync.prototype = {

  // properties required for XPCOM registration:
  classDescription: "Pocket Sync Javascript XPCOM Component",
  classID:          Components.ID("{B26FDE6C-A638-11DF-AE7E-527DDFD72085}"),
  contractID:       "@ril.ideashower.com/rilsync;1",

  QueryInterface: XPCOMUtils.generateQI(),

 ////////////////////////////////////////////////
    
    
    init : function()
    { 
        this.APP    = Components.classes['@ril.ideashower.com/rildelegate;1'].getService().wrappedJSObject;
        this.LIST   = this.APP.LIST;
        this.PREFS  = this.APP.PREFS;
        this.JSON   = Components.classes["@mozilla.org/dom/json;1"].createInstance(Components.interfaces.nsIJSON);
        
        this.APP.registerObserver('ril-api-request-finished');
    },
    
     
    // -- Sync Queue -- //
    
    // Add to sync queue
    addToSyncQueue : function(type, url, batch, delay)
    {	
	if (!this.syncingEnabled()) return false;
	
	var statement = this.APP.DB.createStatement("REPLACE INTO sync_queue (type, url) VALUES (:type, :url)");
	statement.params.type = type;
	statement.params.url = url;
	this.batch.push( statement );
	this.changeReadyForServer = delay && !this.changeReadyForServer ? false : true;
        
        if (!batch) {
            this.flushBatch();
        }	
    },
    
    // Remove from sync queue
    removeFromSyncQueue : function(type, url, batch)
    {
	var statement = this.APP.DB.createStatement("DELETE FROM sync_queue WHERE type = :type AND url = :url");
	statement.params.type = type;
	statement.params.url = url;
	this.batch.push( statement ); 
	this.changeReadyForServer = true;    
        
        if (!batch) {
            this.flushBatch();
        }	
    },
    
    // Clear sync queue
    clearSyncQueue : function(fromLastRowId)
    {
	if (!fromLastRowId) fromLastRowId = 1000000;
	var statement = this.APP.DB.createStatement("DELETE FROM sync_queue WHERE rowid <= :rowId");
	statement.params.rowId = fromLastRowId;
	this.batch.push( statement );     
        this.flushBatch();	
    },
    
    
    // -- Sync -- //
    
    syncingEnabled : function()
    {
        var b=this.APP.getLogin();
        return b;
    },
    
    cancelSync : function()
    {
        this.syncing = false;
        this.sending = false;
        this.getting = false;
	this.waitingToGet = false;
	this.waitingToHardSync = false;
        this.syncWasCancelled = true;
	this.APP.refreshListInAllOpenWindows('list');
    },
    
    sync : function(hard, manual) {
	
	if (!this.syncingEnabled())
	{
	    this.APP.commandInTopRIL('switchToList', 'list');
	    this.APP.genericMessage("You need an account to sync your list with other computers and devices.", [{label:'Register',delegate:this.APP.getTopRIL(),selector:'openLogin'},
		 {label:'Log-in',delegate:this.APP.getTopRIL(),selector:'openLogin'}],
		    false, 'Sync', true);
	    return false;
	}
	
	if (this.syncing)
	{	    
	    // If user clicks 'sync' while it's running in bg, nothing would happen unless we turn off background process
	    if (manual && this.syncInBackgroundTillResults)
	    {
		this.syncInBackgroundTillResults = false;
		this.APP.refreshListInAllOpenWindows('list');
	    }
	    
	    return false;
	}
	this.syncing = true;
        this.syncWasCancelled = false;
        
	this.APP.commandInTopRIL('switchToList', 'list');
        
	this.APP.refreshListInAllOpenWindows('list');
	
	this.waitingToGet = true;
	this.waitingToHardSync = hard;
	
	this.send(true); //if this returns false, it's okay because we just set waitingToGet to be true
    },    
    
    // Sync - Send
    // Sending is done on the main thread to prevent anything from changing while we're retrieving the queue, etc
    send : function(showErrors) {        
	
	if (!this.syncingEnabled()) return false;
	
	try {
	if (this.sending) return false;
	this.sending = true;
	this.delaySend = 0;
        this.APP.clearTimeout(this.syncChangesTO);
        this.syncChangesTO = null;
	
        // Get sync queue               
	var sql, statement, row, item, i;		
	this.lastRowId = 0;
	
	// Retrieve Syncing Queue
	var newQueue = [];
	var readQueue = [];
	var deleteQueue = [];
	var titleQueue = [];
	var tagsQueue = [];
	var scrollQueue = [];
	var oQueue = [];
	sql = "SELECT rowid, type, url FROM sync_queue";	
	statement = this.APP.DB.createStatement(sql);
	try {
	    while (statement.step())
	    {             
		row = statement.row;
		this.lastRowId = this.lastRowId < row.rowid ? row.rowid : this.lastRowId;
		
		item = this.LIST.itemByUrl( row.url );
		if (!item && (row.type != 'delete' && row.type != 'read' && row.type != 'o')) continue;
		
		switch( row.type )
		{
		    case('new'):
			newQueue.push( {
			    url: this.APP.e(item.url),
			    title: this.APP.et(item.title),
			    timeAdded : item.timeUpdated
			} );
			break;
			
		    case('read'):
			readQueue.push( {
			    url: this.APP.e(row.url)
			} );
			break;
			
		    case('delete'):
			deleteQueue.push( {
			    url: this.APP.e(row.url)
			} );
			break;
			
		    case('title'):
			titleQueue.push( {
			    url: this.APP.e(item.url),
			    title: this.APP.et(item.title)
			} );
			break;
			
		    case('tags'):
			tagsQueue.push( {
			    url: this.APP.e(item.url),
			    tags: this.APP.et(item.tagList)
			} );
			break;
			
		    case('scroll'):
			scrollQueue.push( {
			    url: this.APP.e(item.url),
			    views: item.scroll
			} );
			break;
			
		    case('o'):
		    pkg = false;
		    try{ pkg = JSON.parse(row.url); } catch(e){}
		    if (pkg)
				oQueue.push( pkg );
			break;
		    
		}
		
	    } 
	}
	catch(e) {
	    Components.utils.reportError(e);
	}
	finally {
	    statement.reset();
	}
	
	// Clear list
	if (this.syncBatchItems)
	    delete this.syncBatchItems;	
        
	// Anything to send?
	if ( newQueue.length ||
	     readQueue.length ||
	     deleteQueue.length ||
	     titleQueue.length ||
	     tagsQueue.length ||
	     scrollQueue.length ||
	     oQueue.length)
	{
	    
	    // Create Parameter string
	    var params = '';
	    
	    if (newQueue.length)
		params += '&new=' + this.JSON.encode( newQueue );
	    
	    if (readQueue.length)
		params += '&read=' + this.JSON.encode( readQueue );
	    
	    if (deleteQueue.length)
		params += '&delete=' + this.JSON.encode( deleteQueue );
		
	    if (titleQueue.length)
		params += '&update_title=' + this.JSON.encode( titleQueue );
		
	    if (tagsQueue.length)
		params += '&update_tags=' + this.JSON.encode( tagsQueue );
		
	    if (scrollQueue.length)
		params += '&position=' + this.JSON.encode( scrollQueue );
		
	    if (oQueue.length)
		params += '&o=' + this.JSON.encode( oQueue );
            
	    
	    // If manually syncing or doing a hard sync, use immediate flush
	    params += '&' + 'immediate=1';
	    	    
	    // Create connection
            this.request( 'send' , true, params, this, 'sendCallback', showErrors ? null : 'none');
	    
	} else {
	    this.syncing = false; //TODO is this right here?
	    this.sending = false;
	    
	    if (this.waitingToGet) this.get(true);	
	}
	
	} catch(e) { Components.utils.reportError(e); }
        
    },
    
    sendCallback : function(request) {
        try {
	this.syncing = false;
	this.sending = false;
	if (request.success && !this.syncWasCancelled) {
	    
	    this.clearSyncQueue(this.lastRowId);
	    if (this.waitingToGet) this.get(true);
	    
	} else {
	    this.APP.refreshListInAllOpenWindows(); // genericMessage should be in place now... this may not be needed
	}
        this.APP.OBSERVER.notifyObservers(null, 'ril-api-send-finished', request.success);
        } catch(e) { Components.utils.reportError(e); }
    },
    
    
    // Sync - Get
    get : function(fromSync) {
	
	if (!this.syncingEnabled()) return false;
	
	if (fromSync && this.getting) return false; // can allow multiple gets?
        this.syncing = fromSync ? true : this.syncing;
	this.getting = true;
	this.waitingToGet = false;
	
	// Params
	var since = this.PREFS.get('since'); //this.waitingToHardSync ? '' : this.PREFS.get('since'); // disabled hard sync
	this.waitingToHardSync = false;	
	
	var params = 'since='+since+'&tags=1&positions=1';
	
	// if the user's reading list is empty, then we have no use for their read list, so save the cycles and only request unread
	if (this.LIST.list.length == 0)
	params += '&state=unread';
	
	// Create connection
        this.request('get', true, params, this, 'getCallback');
	
    },
    
    getCallback : function(request) {
	try {
	
	// If there are some results, process these in a thread
	var newItems = [];
	var itemId;
	if (request.success && !this.syncWasCancelled)
	{
	    //this.APP.d(request.response);
	    var response = this.JSON.decode( request.response );
	    var compare = false;
	    var compareItem;

	    if (response.complete)
	    {
		// full list returned - hard sync
		// compare current list to this list and send back any items that are saved locally
		// but not on the server
		// first we'll get a copy of the list
		// then as we go through the list below, we remove any items that we have a record of (read/unread)
		// finally after the synced items are run through, we'll go through what's remaining of the compare list
		// and send those back to the server
		compare = this.APP.sortList(this.LIST.list.slice());
	    }
		
		if (response.message)
		{
        	var pktMessageKey = 'message_id_'+response.message.messageId;
        	if (!this.PREFS.getBool(pktMessageKey))
        	{
        		this.PREFS.set(pktMessageKey, true);
        		
				this.APP.commandInTopRIL('genericMessage',
					response.message.message, 
					response.message.buttons
				, !!response.message.showOverTop, 'From Pocket', true);				
			}
		}
	    
	    if (response.status == 1 && response.list)
	    {
		// There is some data in the response
		// This may benefit from being in a thread, but it will be complicated
		// making RILlist's remove/add/update functions threadsafe
		
		if (this.LIST.syncInBackgroundTillResults)
		    this.APP.refreshList('list');
		
	    
		var getItem, i, localItem, getUrl;
		for(var n in response.list)
		{
		    getItem = response.list[n];
		    localItem = this.LIST.itemByUrl( getItem.url );
		    		    
		    if (getItem.state == 1)
		    {
			if (localItem) {
			    this.LIST.mark(localItem.itemId, true, true);
			    
			    if (compare)
			    {
				compareItem = compare[ this.LIST.iByItemId[localItem.itemId] ];
				if (compareItem)
				{
				    compareItem.compare = true;
				}				
			    }
			    
			} else {
			    // nothing to do
			}			
			
		    }
		    else
		    { //unread
			if (localItem)
			{
			    //this.APP.d('----------')
			    //this.APP.d( this.APP.ar(localItem, true) )
			    
			    if (getItem.item_id != localItem.itemId) {
				//this.LIST.updateItemId(localItem.itemId, getItem.item_id);
			    }
			    if (getItem.title != localItem.title) {
				this.LIST.saveTitle(localItem.itemId, getItem.title, true, true);
			    }
			    
			    if (getItem.time_added != localItem.timeUpdated) {
				this.LIST.updateTimeUpdated(localItem.itemId, getItem.time_added, true);
			    }
			    if (getItem.tags != localItem.tagList) {
				this.LIST.compareAndUpdateTags(localItem.itemId, getItem.tags, localItem.tagList, true);
			    }
			    if (getItem.position) {				
                                this.LIST.updateScrollPositions(localItem.itemId, getItem.position, true, true);								
			    }
			    
			    if (compare)
			    {
				compareItem = compare[ this.LIST.iByItemId[localItem.itemId] ];
				if (compareItem)
				{
				    compareItem.compare = true;
				}				
			    }
			}
			else
			{
			    if (this.APP.checkIfValidUrl(getItem.url))
			    {
				
				try
				{
				    itemId = this.LIST.add({
					itemId: getItem.item_id,
					url: getItem.url,
					title: getItem.title,
					timeUpdated: getItem.time_added,
					tagList: getItem.tags ? getItem.tags : false,
					positions : getItem.position ? getItem.position : false
				    }, true, true);
				    newItems.push(itemId);
				}
				catch(e) { Components.utils.reportError(e); }
				
			    }
			}
		    }
		    
		}
	    }

		if (this.APP.justLoggedInAndWaitingToSync) // only do this on login/signup -- prevent it from happening during normal op
		{
			this.APP.justLoggedInAndWaitingToSync = false;
			
		    var cnt=0;
		    var max=1000; // only allow x items to be processed this way to prevent large batches from being passed
		   	for(i in compare)
		    {
			if (!compare[i].compare && compare[i].url)
			{
				this.addToSyncQueue('new', compare[i].url, true);
				
			    cnt++;
			    if (cnt > max) break;
			}
		    }
		}
	    
	    // update sync time
	    this.PREFS.set('since', response.since);
	    
	}
	
	    
	this.syncing = false;
	this.getting = false;	
	this.syncInBackgroundTillResults = false;
	
	if (request.success)
	{
	    this.LIST.endBatchAndRefresh();
	    
	    if (this.PREFS.getBool('autoOffline') && newItems)
		this.APP.updateOfflineQueue(newItems);
	}
	
	} catch(e) {
	    Components.utils.reportError(e);
	    this.APP.genericMessage('There was an error while syncing:\n'+e,
				    [
				    {label:'Try Again', delegate:this, selector:'sync'},
				    {label:'Get Help', delegate:this.APP.getTopRIL(), selector:'getHelp'}
				    ], false, 'Sync', false);
	}	   
    },
    
    
    // -- Read List -- //
    
    getReadList : function(page, filter, sort, count, delegate, noCache)
    {        
	if (!this.syncingEnabled() || this.gettingRead) return false;
	//if (this.syncingRead) return false; // allow overlaps? // TODO: cancel other request - per window?
	delegate.syncingRead = true;
        this.gettingRead = true;
	
        // If there are pending sync changes, those have to be sent first before reloading list
        if (this.syncChangesTO)
        {
            this.APP.registerObserver('ril-api-send-finished', delegate);
            this.send();
            return;
        }
        
        
	var page = page ? page : 1;
	
        // TODO set readFetchCount to use perPage setting and add count limit to api
        var params = 'format=json&state=read&count='+count+'&page='+page;
        if (filter) params += '&search='+filter;
        if (sort) params += '&sort='+sort;
        if (noCache) params += '&nocache=1';
        
        this.request('search', true, params, delegate, 'readCallback', null, 'read');
    },
    
    readCallback : function(request) {
	try {
        
        this.gettingRead = false;
        
        var readList = [];
        var iByReadItemId = {};
        var total = 0;
        
	if (request.success)
	{
	    var response = this.JSON.decode( request.response );
	    var c = 0;
            
	    if (response.status == 1 && response.list)
	    {
		for(var n in response.list)
		{
		    getItem = response.list[n];
		    
		    try
                    {
                    if (this.APP.checkIfValidUrl(getItem.url))
		    {		
			iByReadItemId[ getItem.item_id ] = readList.length;
			
			readList.push( {
				itemId      : getItem.item_id,
				uniqueId    : getItem.item_id,
				url         : getItem.url,
				title       : getItem.title,
				timeUpdated : getItem.time_updated
			    } );
			
		    }
                    } catch(e){}
		    c++; // outside of the loop because we still want to know if there were a full set of items even if some were invalid
		    
		}
                
                total = response.total;
	    }
	    
	    // No more items to get
	    this.noMoreReadItems = (c < this.readFetchCount);
	    
	} else {
	    readList = null;
	}
        
        return {list:readList, iByItem:iByReadItemId, total:total};
	
	} catch(e) {Components.utils.reportError(e);}	    
    },
    
    // -- //
    
    deleteRemote: function(url, batch)
    {
        this.addToSyncQueue( 'delete', url, batch);
        
        this.APP.LIST.readListNeedsRefresh();
        
        if (!batch) {
            this.APP.LIST.endBatchAndRefresh();
        }
    },
    
    
    // -- Auth -- //
    
    localeParams : function()
    {
        var locale, timezone;
        locale = this.APP.language;
        timezone = (new Date()).getTimezoneOffset();        
        return '&locale='+locale+'&timezone='+timezone;
    },
    
    login : function(username, password, delegate, selector)
    {
        this.request('auth', false, 'username='+this.APP.e(username)+'&password='+this.APP.e(password)+this.localeParams(), delegate, selector, 'none');
    },
    
    signup : function(username, password, email, delegate, selector)
    {
        this.request('signup', false, 'username='+this.APP.e(username)+'&password='+this.APP.e(password)+'&email_required=1&email='+this.APP.e(email)+this.localeParams(), delegate, selector, 'none');
    },
    
    touch : function()
    {
       this.request('auth', true, this.localeParams(), false, false, 'none'); 
    },
    
    
    // -- Stats -- //
    
    tk : function(c,m,v,s)
    {
        this.request('track', true, 'c='+c+'&m='+m+'&v='+v+'&s='+s, false, false, 'none');    
    },
    
    share : function(url, service)
    {
        this.request('shared', true, 'url='+this.APP.e(url)+'&service='+this.APP.e(service), false, false, 'none');
    },    
    
    // Requests
    
    request : function(method, login, params, delegate, selector, errorReporting, methodDescription)
    {	
	if (this.APP.listError)
	{
	    this.APP.genericMessage("Because Pocket failed to load correctly, syncing has been disabled to prevent any loss of data.\n\nTry restarting Firefox or clicking 'Get Help'.",
				    [
				    {label:'Get Help', delegate:this.APP.getTopRIL(), selector:'getHelp'}
				    ], false, false, true);
	    return false;
	}
        
        var requestSet          = {delegate:delegate, selector:selector};
        requestSet.request      = Components.classes['@ril.ideashower.com/rilapirequest;1'].createInstance(Components.interfaces.nsIRILAPIRequest);
        var requestId           = requestSet.request.initAndStart(method, login, params, errorReporting ? errorReporting : 'all', methodDescription);
        this.requests[requestId] = requestSet;
    },
    
    requestCallback : function(apiRequest, requestId)
    {
        var requestSet = this.requests[ requestId ];
        if (requestSet)
        {            
            var request = requestSet.request;            
            requestSet.delegate[ requestSet.selector ]( request, request.success, request.response );
            delete requestSet;
        }
    },
    
    
    
    //  -- 
    
    flushBatch : function(callback) {
	// grab a snapshot of the batch and then clear it
	var batch = this.batch.slice();
	this.batch = [];
	
	var sizeOfBatch = batch.length;
        if (batch.length > 0) {            
            this.APP.DB.executeAsync( batch , batch.length, null );
        }
	
	if (sizeOfBatch > 0 && this.changeReadyForServer) {
	    this.changeReadyForServer = false;
	    	    
	    this.APP.clearTimeout(this.syncChangesTO);
	    this.syncChangesTO = this.APP.setTimeout(this.send, this.delaySend==1 ? this.delayedWaitBeforeSending : this.waitBeforeSending, this);
	}
    }
 
};



/**
* XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4).
* XPCOMUtils.generateNSGetModule is for Mozilla 1.9.2 (Firefox 3.6).
*/
if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([RILsync]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([RILsync]);
