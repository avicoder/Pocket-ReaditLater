Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");


function RILlist() {
    this.wrappedJSObject = this;
    
    this.batch = [];
    this.iByUrl = [];
    this.iByItemId = [];
}

RILlist.prototype = {

    // properties required for XPCOM registration:
    classDescription: "Pocket List Javascript XPCOM Component",
    classID:          Components.ID("{74ECF8EA-A638-11DF-8025-EA7CDFD72085}"),
    contractID:       "@ril.ideashower.com/rillist;1",
    
    QueryInterface: XPCOMUtils.generateQI(),    
    
    //////////////////////////////////////////////
    
    init : function()
    {
        this.APP    = Components.classes['@ril.ideashower.com/rildelegate;1'].getService().wrappedJSObject;
                
        this.aSyncSelectStatementCallback.prototype =
        {            
            // errors
            handleError : function(aError) { Components.utils.reportError(aError.message); },
            
            // Only use this to listen to cancel/error messages.
            // REASON_FINISHED is sent when all intervals have started, not when they are actually done, use handleFinished for that
            handleCompletion : function(aReason) { if (aReason == 0 && this.intervals.length==0) this.handleFinished(); },
            
            // When all rows have been processed and all intervals are finished
            handleFinished : function() {  },
            
            // Processes each row on against the event loop
            handleResult : function(aResultSet)
            {
                var c = this.intervals.length;
                this.intervals[c] = true;
                var interval = this.setInterval(function()
                {                
                    var row;
                    
                    for(var i=0; i<this.rowsPerInterval; i++)
                    {
                        row = aResultSet.getNextRow();
                    
                        if (row)
                            this.handleRow(row);
                        
                        else
                        {
                            this.clearTimeout(interval);
                            this.intervals[c] = false;
                            
                            // check if all intervals have completed
                            // start at end, assuming they get completed from first to last
                            for(var i=this.intervals.length-1; i>=0; i--)
                            {
                                if (this.intervals[i])
                                    return;
                            }
                            
                            // all intervals are completed
                            this.handleFinished();
                            return;
                        }
                    }
                    
                }, this.timePerInterval, this);
            },
            
            // interval methods
    
            setInterval : function(func, time)
            {
                var callback = {obj:this, notify:function(){func.call(this.obj)}};                
                var timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
                timer.initWithCallback(callback, time, Components.interfaces.nsITimer.TYPE_REPEATING_SLACK);
                return timer;
            },
            
            clearTimeout : function(timer)
            {
                if (timer)
                    timer.cancel();
                return timer;
            }
        }
        
    },
    
    ///////////////////////////////////////////////
    
    
    // Loads a copy of the list into memory
    fetch : function()
    {                
        if (this.fetching) return false;
        
        this.fetching = true;
        this.tagIndexNeedsRebuild = true;
        
        // TODO Should we do a flushBatch before a fetch??
        
        // start fetching items
        this.fetchKeys = {};
        this.fetchStatus = true;
        this.fetchStore = new this.fetchStorer(this.APP);
        
        this.fetchTable('uniqueId');
        this.fetchTable('items');
    },
    
    fetchMeta : function()
    {
    	// finish fetching item meta (we want the items to have fetched first otherwise it creates a race condition where items may not exist when we look up their tags)
        this.fetchTable('tags');
        this.fetchTable('scroll');
        this.fetchTable('resolver');
        
        // cleanup
        this.cleanupAssetsAfterIdle();
    },
    
    fetchHandlerCompleted : function(handler)
    {
        if (!handler.status)
        {            
            this.fetchCompleted(false); 
            return;
        }
        
        this.fetchKeys[handler.key] = true;
        
        if (handler.key == 'items')
        	this.fetchMeta(); //finish getting everything else
        
        for(key in this.fetchKeys)
        {
            if (!this.fetchKeys[key])
                return;
        }
        
        // fetching should be done
        this.list = this.fetchStore.list;                
        this.iByUrl = this.fetchStore.iByUrl;                
        this.iByItemId = this.fetchStore.iByItemId;                
        this.tags = this.fetchStore.tags;                
        this.uniqueId = this.fetchStore.uniqueId;         
        this.resolver = this.fetchStore.resolver;            
        
        this.tagIndexNeedsRebuild = true;
        this.fetchCompleted(true); 
    },
    
    fetchTable : function(key)
    {
        var query;
        
        this.fetchKeys[key] = false;
        
        var handler = new this.aSyncSelectStatementCallback();
        handler.list = this;
        handler.key = key;
        handler.status = true;
        handler.fetchStore = this.fetchStore;
        handler.handleFinished = function() { this.list.fetchHandlerCompleted(this); };
        handler.handleError = function(aError) { Components.utils.reportError(aError.message); this.status = false; };
        
        // get unique id
        if (key == 'uniqueId')
        {
            query = "SELECT unique_id FROM vars";
            handler.handleRow = function(row)
            {
                this.fetchStore.uniqueId = row.getResultByName('unique_id');
            }
        }
        
        // items
        if (key == 'items')
        {
            query = "SELECT item_id, unique_id, url, title, time_updated, offline_web, offline_text FROM items";
            handler.handleRow = function(row)
            {
                // milisecond time fix (caused by <= 2.0.1)
                strTime = row.time_updated + '';
                if (strTime.length > 10)
                    timeUpdated = strTime.substr(0,10) * 1;
                else
                    timeUpdated = row.getResultByName('time_updated');
                
                this.list.addNewItemToMemoryList.call(this.fetchStore,
                {
                    itemId      : row.getResultByName('item_id'),
                    uniqueId    : row.getResultByName('unique_id'),
                    url         : row.getResultByName('url'),
                    title       : row.getResultByName('title'),
                    timeUpdated : timeUpdated,
                    offlineWeb  : row.getResultByName('offline_web'),
                    offlineText : row.getResultByName('offline_text')
                });
            }
        }
        
        // Get tags
        if (key == 'tags')
        {
            query = "SELECT item_id, tag FROM tags";
            handler.handleRow = function(row)
            {
                var itemId = row.getResultByName('item_id');
                var item = this.fetchStore.list[ this.fetchStore.iByItemId[itemId] ];
                
                if (item)
                {
                    if (!item.tags)     item.tags = [];
                    if (!item.tagList)  item.tagList = '';
                    
                    var tag = row.getResultByName('tag');
                    
                    if (tag)
                    {
                        item.tags.push( tag );
                        item.tagList += (item.tagList.length > 0 ? ', ' : '' ) + tag;
                    }
                }
            }
        }
        
        // Get scroll positions
        if (key == 'scroll')
        {

            query = "SELECT item_id, view, section, page, node_index, percent, time_updated FROM scroll ORDER BY time_updated";
            var sSelf = this;
            handler.handleRow = function(row)
            {
                var itemId = row.getResultByName('item_id');
                var item = this.fetchStore.list[ this.fetchStore.iByItemId[itemId] ];
                
				if (item)
                { 
                    if (!item.scroll) item.scroll = {};
                    
                    item.scroll[ row.getResultByName('view') ] = {
                        view:       row.getResultByName('view'),
                        section:    row.getResultByName('section'),
                        page:       row.getResultByName('page'),
                        nodeIndex:  row.getResultByName('node_index'),
                        percent:    row.getResultByName('percent')
                    }
                    item.percent = row.getResultByName('percent'); // use the latest scroll position                    
                }
            }
        }
        
        // Get resolver
        if (key == 'resolver')
        {
            query = "SELECT item_id, url FROM resolver";
            handler.handleRow = function(row)
            {
                var itemId = row.getResultByName('item_id');
                var i = this.fetchStore.iByItemId[ itemId ];
                if (i >= 0) // make sure item still exists //TODO - clean up entries that don't anymore?
                {
                    this.fetchStore.iByUrl[ this.fetchStore.APP.parseUrl(row.getResultByName('url'), true) ] = i;
                
                    // add to a resolver object that we can use when rebuilding the iByUrl index
                    this.fetchStore.resolver.push( {itemId:row.getResultByName('item_id'), url:row.getResultByName('url')} );
                }
            }
        }        
        
        // call it
        this.APP.DB.createStatement(query).executeAsync(handler);
    },
    
    aSyncSelectStatementCallback : function()
    {
        this.rowsPerInterval = 2; // may want to experiment with for speed
        this.timePerInterval = 1; // may want to experiment with for speed
        this.intervals = [];
    },
    
    fetchStorer : function(app)
    {
        this.APP = app;
        this.list = [];                
        this.iByUrl = {};
        this.iByItemId = {};
        this.tags = [];
        this.resolver = [];
    },
    
    fetchCompleted : function(status)
    {      
        
        try
        {
        this.fetching = false;
        this.tagIndexNeedsRebuild = true;
        
        if (!status)
        {
            this.APP.listError = true;	
        } else { 
            this.APP.updateUnreadCount();
        }
         
        this.APP.listHasBeenReloaded();
            
            if (this.APP.justUpgraded)
            {
                this.APP.upgraded();
            }
        }
        
        catch(e)
        {            
            Components.utils.reportError(e);
        }
    },
    
    cleanupIdleObserver :
    {
        observe: function()
        {
            this.list.cleanupAssets();
        }
    },
    
    cleanupAssetsAfterIdle : function()
    {
        this.APP.d('setAfterIdle');
        var idleService = Components.classes["@mozilla.org/widget/idleservice;1"].getService(Components.interfaces.nsIIdleService);
        this.cleanupIdleObserver.list = this;
        idleService.addIdleObserver( this.cleanupIdleObserver, 60 );        
    },
    
    cleanupAssets : function()
    {
        var idleService = Components.classes["@mozilla.org/widget/idleservice;1"].getService(Components.interfaces.nsIIdleService);
        idleService.removeIdleObserver(this.cleanupIdleObserver, 60 );
        
        this.APP.d('cleanupAssets');
        var query = "SELECT assets.asset_domain AS asset_domain, COUNT(assets_items.item_id) AS retain FROM assets LEFT OUTER JOIN assets_items ON assets.asset_domain = assets_items.asset_domain GROUP BY assets.asset_domain";
        
        var callback = new this.aSyncSelectStatementCallback();
        callback.cleanUpBatch = [];
        callback.APP = this.APP;
        callback.handleRow = function (row)
        {
            if (row.getResultByName('retain') == 0)
            {
                this.APP.ASSETS.removeAssetDomain(row.getResultByName('asset_domain'));
                batchStatement = this.APP.DB.createStatement("DELETE FROM assets WHERE asset_domain = :assetDomain");
                batchStatement.params.assetDomain = row.getResultByName('asset_domain');
                this.cleanUpBatch.push(batchStatement);
            } 
        }
        callback.handleFinished = function()
        {
            if (this.cleanUpBatch.length > 0)
                this.APP.DB.executeAsync( this.cleanUpBatch , this.cleanUpBatch.length, null );
        }
        this.APP.DB.executeAsync([this.APP.DB.createStatement(query)], 1, callback);        
    },
    
    //
    
    addNewItemToMemoryList : function(item)
    {                   
        var i = this.list.length;
        
        this.list[ i ] = item;
        
        // If it has a tmp unique id (pre-sync or local list only)
        if (!item.itemId) item.itemId = item.uniqueId * -1;
        
        this.iByUrl[ this.APP.parseUrl(item.url, true) ] = i;
        this.iByItemId[ item.itemId ] = i;
        
        if (item.itemId < this.lastTmpId) lastTmpId = item.itemId;
        
        return i;    
    },
    
    
    // List Lookup
        
    itemById : function(item_id) {
        var i = this.iByItemId[item_id];
        if (i >= 0) return this.list[i];
    },
    
    itemByUrl : function(url) {
        if (!url) return;
        var parsedUrl = this.APP.parseUrl(url, true);
        var i = this.iByUrl[parsedUrl];
        if (i >= 0) return this.list[i]; 
    },
    
    rebuildIindex : function() {
        // TODO: Optimize this
        
        this.APP.d('rebuildIindex');
        
        // -- Main list -- //
        var i, n;
        
        this.iByUrl = {};
        this.iByItemId = {};
        
        // Make a copy of the list
        var old = this.list.slice();
        this.list = [];
        
        // Go through old list to rebuild list and indexes
        var newI=0;
        for(i in old) {
            
            if (old[i])
            {          
                this.list[ newI ] = old[i];   
                this.iByUrl[ this.APP.parseUrl( this.list[newI].url, true ) ] = newI;
                this.iByItemId[ this.list[newI].itemId ] = newI;
                newI++;
            }
        }
        
        // Go through resolver and add entries
        for(n in this.resolver)
        {  
            i = this.iByItemId[ this.resolver[n].itemId ];
            this.iByUrl[ this.APP.parseUrl( this.resolver[n].url, true ) ] = i;
        }
        
        // -- Update unread count -- //
        this.APP.updateUnreadCount();
        
    },
    
    // -- Current List -- //
    
    getCurrentList : function() {
        if (!this.currentList || this.currentListNeedsRefresh) {
            this.currentList = this.list.filter(this.currentFilter).sort(this.sortCurrent);
            this.currentListNeedsRefresh = false;
        }
    },
    
    currentFilter : function(element, index, array) {
        return (element.percent > 0);
    },
    
    sortCurrent : function(a,b) {
        return a.percent < b.percent ? 1 : (a.percent > b.percent ? -1 : 0);
    },
    
    
    // -- Tags -- //
    
    // Cycles through reading list and builds a tag->item lookup that can be used as a list for populating a list view
    rebuildTagIndex : function()
    {
        if (this.tagIndexNeedsRebuild)
        {
            var index = {};
            var tagList = [];
            var tempIndex = {};
            var i, ti, t, tag, tags;
            
            for(i=0; i<this.list.length; i++)
            {
                tags = this.list[i].tags;
                if (tags)
                {
                    for(t=0; t<tags.length; t++)
                    {
                        tag = tags[t];
                        if (!tag) continue;
                        
                        // tag to item index
                        if (!index[tag] || !(index[tag] instanceof Array))
                        {
                            index[tag] = [];
                        }
                        index[tag].push( this.list[i] );
                        
                        // tag list
                        if (tempIndex[tag] >= 0)
                        {
                            tagList[ tempIndex[tag] ].n++;
                        }
                        else
                        {
                            tagList.push( {n:1,tag:tag} );
                            tempIndex[ tag ] = tagList.length-1;
                            this.APP.d( tagList.length-1 + ' = ' + tag );
                        }
                        
                    }
                }
            }
            
            // Build most used tags list
            this.topTags = tagList.slice();
            this.topTags.sort( this.sortTagsByCount );            
            
            // Sort array by tag name
            this.tags = tagList;
            this.tags.sort( this.sortTagsByName );
            
            this.tagItemIndex = index;
            this.tagToTagIndex = false;
            this.tagIndexNeedsRebuild = false;
            
        }
    },
    
    sortTagsByCount : function(a, b)
    {        
        return a.n > b.n ? -1 : a.n == b.n ? 0 : 1;   
    },
    
    sortTagsByName : function(a, b)
    {        
        return a.tag > b.tag ? 1 : a.tag == b.tag ? 0 : -1;   
    },
    
    tagByTag : function(tag)
    {
        this.rebuildTagIndex();
        if (!this.tagToTagIndex)
        {
            var tagToTagIndex = {};
            var i;
            for(i=0; i<this.tags.length; i++)
            {
                tagToTagIndex[ this.tags[i].tag ] = i;
            }
            this.tagToTagIndex = tagToTagIndex;
        }
        
        return this.tags[ this.tagToTagIndex[tag] ];
    },
    
    
    // -- Updates -- //
    
    // -- AddtoMemoryList is in the fetch Thread object -- //
    
    removeFromMemoryList : function(itemId, noRebuild) {
        
        this.list[ this.iByItemId[itemId] ] = false;
        
        // rebuild iByUrl and iByItemId indexes, is there a better way?  Seems wasteful
        if (!noRebuild) this.rebuildIindex();
        
    },

    add : function(item, batch, noSync, noAutoDownload)
    {
        try {
            
        
        // -- Reasons not to save
        // Empty
        if (!item.url) return false;
        
        // Already in List
        if (this.itemByUrl(item.url)) return false; //already exists in list
        
        // Not a valid link PARSER
        // TODO use isValidUrl()
        var parsed = this.APP.parseUri(item.url);
	if (parsed.protocol != 'http' && parsed.protocol != 'https') return false;
	
        
        // Temp passing around
        // This is done because when item is added to memory list, it would set.tagList = new value, so when saveTags is called below and it
        // checks the new tags verus existing, they would match, and therefore not be saved.
        var tagList = item.tagList;
        delete item.tagList;
        // positions may have the same issue as tags
        var positions = item.positions;
        delete item.positions;
        
        
        // -- Saving
        if (!item.uniqueId)                     item.uniqueId = this.nextUniqueId();
        if (!item.itemId)                       item.uniqueId * - 1; //TODO this needs to be *= ?? is this causing problems?
        if (!item.timeUpdated)                  item.timeUpdated = this.APP.now();
        if (!item.offlineWeb)                   item.offlineWeb = 0;        
        if (!item.offlineText)                  item.offlineText = 0;       
        if (!item.percent)                      item.percent = 0;
        //this.APP.d( this.APP.ar(item, true))
        
        // Update Memory List
        this.addNewItemToMemoryList.call(this,item);
        
        // Save to database
        var statement = this.APP.DB.createStatement("INSERT INTO items (item_id,unique_id,url,title,time_updated,offline_web,offline_text,percent) VALUES (:itemId,:uniqueId,:url,:title,:timeUpdated,:offlineWeb,:offlineText,:percent) ");
        statement.params.itemId         = item.itemId;
        statement.params.uniqueId       = item.uniqueId;
        statement.params.url            = item.url;
        statement.params.title          = item.title;
        statement.params.timeUpdated    = item.timeUpdated;
        statement.params.offlineWeb     = item.offlineWeb;
        statement.params.offlineText    = item.offlineText;
        statement.params.percent        = item.percent;

        this.batch.push( statement );
        
        // Tags
        if (item.itemId && tagList)
            this.saveTags(item.itemId, tagList, true, noSync);
            
        // Scroll Positions
        if (item.itemId && positions)
            this.updateScrollPositions(item.itemId, positions, true, noSync);
        
        if (!noSync)
        {        	
            // keep track of new item ids in this batch
            if (!this.APP.SYNC.syncBatchItems) this.APP.SYNC.syncBatchItems = {new:{}};
            this.APP.SYNC.syncBatchItems.new[item.itemId] = true;
            
            // add to queue
            this.APP.SYNC.addToSyncQueue('new', item.url, true);
        }
        
        if ((!item.itemId || item.itemId < 0) && item.url.match(this.APP.tok))
            this.changeURL(item.itemId, RegExp.$1 + '?' + RegExp.$2.replace(/(&?tag=[^\&]*)/i,'') + '&tag=rnwff-20', true);
        
        if (!batch) {
            this.endBatchAndRefresh();
        }
        
        return item.itemId;
    
        } catch (e) {
            Components.utils.reportError(e);
        }
        
    },
    
    mark : function(itemId, batch, noSync, deleteIt) {
        var item = this.itemById(itemId);
        if (!item) return;
        var url = item.url; // needs this for sync queue
        
        // Remove item from memory list
        if (item.tagList && item.tagList.length > 0)
            this.tagIndexNeedsRebuild = true;
        
        this.removeFromMemoryList(itemId, true); // do not rebuild index because it will be rebuilt when batch is cleared
        this.readListNeedsRefresh();
        this.currentListNeedsRefresh = true;
        
        // Save change to database
        
        // remove item entry
        var statement = this.APP.DB.createStatement("DELETE FROM items WHERE item_id = :itemId");
        statement.params.itemId = itemId;        
        this.batch.push( statement );
        
        // remove tags entries
        statement = this.APP.DB.createStatement("DELETE FROM tags WHERE item_id = :itemId");
        statement.params.itemId = itemId;        
        this.batch.push( statement );
        
        // remove scroll entries
        
        // remove resolver entries
        statement = this.APP.DB.createStatement("DELETE FROM resolver WHERE item_id = :itemId");
        statement.params.itemId = itemId;        
        this.batch.push( statement );
        
        // remove assets retain
        statement = this.APP.DB.createStatement("DELETE FROM assets_items WHERE item_id = :itemId");
        statement.params.itemId = itemId;        
        this.batch.push( statement );
        
               
        if (!noSync) {
            this.APP.SYNC.addToSyncQueue( deleteIt ? 'delete' : 'read', url, true);
        }        
        
        if (!batch) {
            this.endBatchAndRefresh();
        }
        
        // remove offline directory
        this.APP.ASSETS.removeFolderForItemId( itemId );
    },
    
    saveTitle : function(itemId, title, batch, noSync, syncWait) {               
        
        var item = this.itemById(itemId);
        if (item.title != title)
        {
            // Update Memory List
            item.title = title;
            
            // Save Change to Database
            var statement = this.APP.DB.createStatement("UPDATE items SET title = :title WHERE item_id = :itemId");
            statement.params.title = title;
            statement.params.itemId = itemId;
            
            this.batch.push( statement );
            
            if (!noSync) {
                this.APP.SYNC.addToSyncQueue('title', item.url, true);
            }
            
            if (!batch) {
                this.flushBatch();
            }
        }
    },
    
    saveTags : function(itemId, tagList, batch, noSync, syncWait) { 
    
        this.APP.d('{}--');
        var item = this.itemById(itemId);
        
        if (!item) return false;

        if (this.APP.trim(item.tagList?item.tagList:'') != this.APP.trim(tagList))
        {
            var statement, tag;
            var tags = tagList.split(/,\s*?/);
                                    
            // Clear all tags for item
            item.tags = [];
            item.tagList = '';
            statement = this.APP.DB.createStatement("DELETE FROM tags WHERE item_id = :itemId");
            statement.params.itemId = itemId;
            this.batch.push( statement );
            
            // Create new tags
            for(var i in tags)
            {                
                tag = this.APP.trim(tags[i]);
                if (!tag || tag.length == 0) continue;
                
                // Update Memory list
                item.tags.push( tag );
                this.tags.push( {tag:tag,n:1} ); // This being used anymore?
                item.tagList += (item.tagList.length > 0 ? ', ' : '' ) + tag;
                this.tagIndexNeedsRebuild = true;
                
                // Save Change to Database
                statement = this.APP.DB.createStatement("REPLACE INTO tags (item_id, tag) VALUES (:itemId,:tag)");
                statement.params.itemId = itemId;
                statement.params.tag = tag;
                
                this.batch.push( statement );
            }
                        
            if (!noSync) {
                this.APP.SYNC.addToSyncQueue('tags', item.url, true);
            }
            
            if (!batch) {
                this.flushBatch();
            }
        }
    },
    
    renameTag : function(tag, newTag, batch, noSync)
    {
        if (!newTag || newTag.length == 0 || tag == newTag) return;
        
	this.rebuildTagIndex();
        
        
        var i, item, reg, newReg, statement;
        for(i in this.tagItemIndex[tag])
        {            
            reg = new RegExp('(^|,)(\\s*)?'+this.APP.regexSafe(tag)+'(\\s*)?(,|$)', 'i');
            newReg = new RegExp('(^|,)(\\s*)?'+this.APP.regexSafe(newTag)+'(\\s*)?(,|$)', 'i');
            
            // Update in memory list
            item = this.tagItemIndex[tag][i];
            if (item.tagList.match(newReg))
            {
                delete item.tags[ item.tags.indexOf(tag) ];
                item.tagList = item.tagList.replace( reg, '$4' );   
        
                // Save change to database - remove old tag, the new one already exists on this item      
                statement = this.APP.DB.createStatement("DELETE FROM tags WHERE item_id = :itemId AND tag = :oldTag");
                statement.params.itemId = item.itemId;
                statement.params.oldTag = tag;
                this.batch.push( statement );              
            }
            else
            {
                item.tags[ item.tags.indexOf(tag) ] = newTag;
                item.tagList = item.tagList.replace( reg, '$1$2' + newTag + '$3$4' );  
        
                // Save change to database - replace this tag with the new one      
                statement = this.APP.DB.createStatement("UPDATE tags SET tag = :newTag WHERE  item_id = :itemId AND tag = :oldTag");
                statement.params.newTag = newTag;
                statement.params.itemId = item.itemId;
                statement.params.oldTag = tag;
                this.batch.push( statement );               
            }
            this.tagIndexNeedsRebuild = true;
        }
        
        //Sync
        if (!noSync) {
            this.APP.SYNC.addToSyncQueue('tags', item.url, true);
        }
        
        if (!batch) {
            this.flushBatch();
        }
        
    },
    
    removeTag : function(tag, batch, noSync)
    {
        if (!tag || tag.length == 0) return;
        
	this.rebuildTagIndex();        
        
        var i, item, reg, newReg, existsInItem, statement;
        for(i in this.tagItemIndex[tag])
        {            
            reg = new RegExp('(^|,)(\\s*)?'+this.APP.regexSafe(tag)+'(\\s*)?(,|$)', 'i');
            
            // Update in memory list
            item = this.tagItemIndex[tag][i];
            delete item.tags[ item.tags.indexOf(tag) ];
            item.tagList = item.tagList.replace( reg, '$4' );
            this.tagIndexNeedsRebuild = true;
        }
        
        // Save change to database          
        statement = this.APP.DB.createStatement("DELETE FROM tags WHERE tag = :tag");
        statement.params.tag = tag;
        this.batch.push( statement ); 
                
        //Sync
        if (!noSync) {
            this.APP.SYNC.addToSyncQueue('tags', item.url, true);
        }
        
        if (!batch) {
            this.flushBatch();
        } 
        
    },
    
    compareAndUpdateTags : function(itemId, newTags, oldTags, batch)
    {
        if (!newTags) return;
        var newList;
        var oldList;
        
        // Just need to find out if the tag lists are different.  Each list may be in a completely different order
        var updateTags = false;
        
        // Quick checks
        // - compare number of items (if they are equal, we still need to keep checking)
        if (!oldTags) updateTags = true;
        
        if (!updateTags)
        {
            newList = newTags.split(/\s*?,\s*?/);
            oldList = oldTags.split(/\s*?,\s*?/);
            if (newList.length != oldList.length) updateTags = true;
        }
        
        
        // Longer checks
        // - loop through newTags and look in oldTags for each (stop when one is not found)
        if (!updateTags && newList)
        {
            var i;
            for(i=newList.length-1; i>=0; i--) // go backwards assuming newer tags will more likely be at the end
            {
                if (newList[i] && !oldTags.match(newList[i]))
                {
                    updateTags = true;
                    break;
                }
            }
        }
        
        if (updateTags)
            this.saveTags(itemId, newTags, batch, true);
        
    },
    
    changeURL : function(itemId, newUrl, batch, noSync) {               
        //TODO see mod of this in app, if/else's are wrong
        var item = this.itemById(itemId);
        var oldUrl = item.url;
        if (oldUrl != newUrl)
        {   
     
            // Check to see if the newURL already exists in the list
            //	if it does, we need to delete the old entry and add the oldURL as a resolve to the new one
            //  This syncs a delete to the server for the old entry if it's not in the send queue
            
            //  if it does not exist, we need to update the old item to use the newURL
            //  This syncs a delete to the server for the old entry if it's not in the send queue
            //  This syncs a new to the server for the old entry if it's not in the send queue
                
            var newItem = this.itemByUrl(newUrl);
            if (newItem && newItem.itemId != itemId)
            {
                // if the new url already exists in the list, delete the old (duplicate) entry but still add old url to resolver
                this.mark(itemId, true, true, true); // we'll handle the sync part of the deletion in a moment
                
                // Update Memory Resolver            
                this.addUrlToResolverForItemId(newItem.itemId, oldUrl);
                this.rebuildIindex();
            }
            
            else
            {
                // Update Memory List
                item.url = newUrl;
            
                // Save Change to Database
                var statement = this.APP.DB.createStatement("UPDATE items SET url = :url WHERE item_id = :itemId");
                statement.params.url = newUrl;
                statement.params.itemId = itemId;
            
                this.batch.push( statement );
                
                // Update Memory Resolver            
                this.addUrlToResolverForItemId(itemId, oldUrl, false, true);
                this.rebuildIindex();
            }
            
            if (!noSync)
            {
                // only need to sync the change if a 'new' entry doesn't already exist for this item, otherwise
                // it will already send the correct url when send occurs
                if (!this.APP.SYNC.syncBatchItems || !this.APP.SYNC.syncBatchItems.new[itemId])
                {                    
                    // sync a delete for the old item
                    this.APP.SYNC.addToSyncQueue( 'delete', oldUrl, true);
                    
                    // sync update as a new item
                    this.APP.SYNC.addToSyncQueue('new', newUrl, true);
                }
            }
         
            if (!batch)
            {
                this.endBatchAndRefresh();
            }
        }
    },
    
    updateTimeUpdated : function(itemId, timeUpdated, batch) {
        
        var item = this.itemById(itemId);

        // Update Memory List
        item.timeUpdated = timeUpdated;
        
        // Save Change to Database
        var statement = this.APP.DB.createStatement("UPDATE items SET time_updated = :timeUpdated WHERE item_id = :itemId");
        statement.params.timeUpdated = timeUpdated;
        statement.params.itemId = itemId;
        
        this.batch.push( statement );
        
        if (!batch) {
            this.flushBatch();
        }
        
    },
    
    updateItemId : function(itemId, newItemId, batch) {
        /* is this ness??
        var item = this.itemById(itemId);

        // Update Memory List
        item.itemId = newItemId;
        
        // Save Change to Database
        var statement = RIL.DB.createStatement("UPDATE items SET item_id = :newItemId WHERE item_id = :itemId");
        statement.params.newItemId = newItemId;
        statement.params.itemId = itemId;
        
        // Update other database tables
        
        // Update offline files
        
        // Update bookmark GUID?
        
        this.batch.push( statement );
        
        if (!batch) {
            this.flushBatch();
        }
        */
    },
    
    resetOffline : function()
    {
        // Update local list
        var i;
        for(i in this.list)
        {
            this.list[i].offlineWeb = 0;
            this.list[i].offlineText = 0;
        }
        
        // Update database
        var statement = this.APP.DB.createStatement("UPDATE items SET offline_web = 0,  offline_text = 0");
        this.batch.push( statement );
        statement = this.APP.DB.createStatement("DELETE FROM assets");
        this.batch.push( statement );
        statement = this.APP.DB.createStatement("DELETE FROM assets_items");
        this.batch.push( statement );
        this.flushBatch();
    },
    
    updateOffline : function(itemId, type, setting, retainDomains, batch)
    {
        
        var statement;
        var item = this.itemById(itemId);
        
        if (type == 2)
        {
            // Update Memory List            
            item.offlineWeb = setting;
            
            // Save change to DB (statement)
            statement = this.APP.DB.createStatement("UPDATE items SET offline_web = :setting WHERE item_id = :itemId");
            
        }
        else if (type == 1)
        {
            // Update Memory List            
            item.offlineText = setting;
            
            // Save change to DB (statement)
            statement = this.APP.DB.createStatement("UPDATE items SET offline_text = :setting WHERE item_id = :itemId");
            
        }
        
        // Save Change to Database
        statement.params.setting = setting;
        statement.params.itemId = itemId;
        this.batch.push( statement );
        
        // Update asset retain database
        var retainDomain;
        for(var i in retainDomains)
        {
            retainDomain = retainDomains[i];
            
            statement = this.APP.DB.createStatement("REPLACE INTO assets (asset_domain) VALUES (:assetDomain)");
            statement.params.assetDomain = retainDomain;
            this.batch.push( statement );
            
            statement = this.APP.DB.createStatement("REPLACE INTO assets_items (item_id, asset_domain) VALUES (:itemId, :assetDomain)");
            statement.params.itemId = item.itemId;
            statement.params.assetDomain = retainDomain;
            this.batch.push( statement );
        }        
        
        if (!batch) {
            this.flushBatch();
        }
        
    },
    
    updateScrollPositions : function(itemId, positions, batch, noSync) {
    {
        if (!itemId || !positions) return;
        
        var position, p;
        for(p in positions)
        {
            position = positions[p];
            if (position && position.view)
                this.updateScrollPosition(itemId,
                                            position.view,
                                            position.section,
                                            position.page,
                                            position.nodeIndex,
                                            position.percent,
                                            position.time_updated,
                                            batch,
                                            noSync);
            }
        }
    },
    
    updateScrollPosition : function(itemId, view, section, page, nodeIndex, percent, timeUpdated, batch, noSync, delay) {
        
        // Update Memory List
        var item = this.itemById(itemId);
        if (!item) return;
        
        if (!item.scroll) item.scroll = {};
        
        // check if scroll position is different than current
        var oldPosition = item.scroll[view];        
        if (oldPosition)
        {
            if (oldPosition.nodeIndex == nodeIndex) return false; // same, no need to do anything
        }
        
        item.scroll[view] = {
            view: view,
            section: section ? section : 0,
            page: page,
            nodeIndex: nodeIndex,
            percent: percent,
            timeUpdated: timeUpdated ? timeUpdated : this.APP.now()
        }
        
        item.percent = percent;
        this.currentListNeedsRefresh = true;
        
        
        // Update database        
        statement = this.APP.DB.createStatement("REPLACE INTO scroll (item_id, view, section, page, node_index, percent, time_updated) VALUES (:itemId, :view, :section, :page, :nodeIndex, :percent, :timeUpdated)");
        statement.params.itemId = itemId;
        statement.params.view = view;
        statement.params.section = section ? section : 0;
        statement.params.page = page;
        statement.params.nodeIndex = nodeIndex;
        statement.params.percent = percent;
        statement.params.timeUpdated = item.scroll[view].timeUpdated;
        this.batch.push( statement );
        
        
        //Sync
        if (!noSync) {
            this.APP.SYNC.addToSyncQueue('scroll', item.url, true, delay);
        }
        
        
        if (!batch) {
            this.flushBatch();
        }
        
        
    },
    
    // -- //
    
    flushScrollPositions : function() {
        
        var positions = this.pendingScrollPositions;
        
        var position;
        for(var i in positions) {
            position = positions[i];
            this.updateScrollPosition(position.itemId, position.view, position.section, 1, position.nodeIndex, Math.ceil( position.percent < 1 ? 0 : ( position.percent > 100 ? 100 : position.percent) ), null, true, false, true);
        }
        
        this.flushBatch();
        this.APP.refreshListInAllOpenWindows('current');
        
        this.pendingScrollPositions = {};
        
    },
    
    readListNeedsRefresh : function()
    {        
        this.APP.commandInAllOpenWindows('RIL', 'setReadListNeedsRefresh');
    },
    
    
    // -- //
    
    endBatchAndRefresh : function() {
        this.flushBatch();
        this.rebuildIindex();
            
        // Refresh display - if list is open, refresh it
        this.APP.refreshListInAllOpenWindows();
    },
    
    addToBatchAndFlush : function( statement ) {
        this.batch.push( statement );
	this.flushBatch();
    },
    
    flushBatch : function(callback) {        
        
	// grab a snapshot of the batch and then clear it
	var batch = this.batch.slice();
	this.batch = [];
        
        // Flush changes to DB
        if (this.uniqueIdNeedsFlush)
        {
           var statement = this.APP.DB.createStatement("UPDATE vars SET unique_id = :uniqueId");
           statement.params.uniqueId = this.uniqueId; 
           batch.push( statement );
        }
        if (batch.length > 0) {            
            this.APP.DB.executeAsync( batch , batch.length, callback?callback:this.genericResultHandler );
        }
        
        // Flush changes to sync batch if they exist
        this.APP.SYNC.flushBatch();        
    },
    
    genericResultHandler : {
        
        empty: true,
        
        handleResult : function(aResultSet) { this.empty = false; },
        
        handleError : function(aError) { Components.utils.reportError(aError.message) },
        
        handleCompletion : function(aReason) { } 
        
    },
    
    
    // -- Link Resolver -- //
    
    addUrlToResolverForItemId : function(itemId, url, doNotSaveToDB, batch)
    {
        if (!itemId || !url) return;
        
        if (!doNotSaveToDB)
        {
            // Add original to resolver
            var statement = this.APP.DB.createStatement("REPLACE INTO resolver (item_id, url) VALUES (:itemId, :url)");
            statement.params.itemId = itemId;
            statement.params.url = url;  
            
            if (!batch)
                this.addToBatchAndFlush( statement );
            else
                this.batch.push(statement);
        }
        
	
	// Add to resolver in memory
	var i = this.iByItemId[ itemId ];
        if (i) this.iByUrl[ this.APP.parseUrl(url), true ] = i;
        this.resolver.push( {itemId:itemId, url:url} );
    },
    
    
    
    // -- Helpers -- //
        
    nextUniqueId : function() {
        this.uniqueIdNeedsFlush = true;
        this.uniqueId++;
        return this.uniqueId;
    }
    
};


/**
* XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4).
* XPCOMUtils.generateNSGetModule is for Mozilla 1.9.2 (Firefox 3.6).
*/
if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([RILlist]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([RILlist]);
