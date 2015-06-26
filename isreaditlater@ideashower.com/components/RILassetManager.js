/*
 
License: This source code may not be used in other applications whether they
be personal, commercial, free, or paid without written permission from Pocket.
 
 
 
 
 
 
 
 
 
 
/// CHANGES TO THIS NEED TO BE COPIED BETWEEN /components and /chrome until we drop support for 3.6









 
 
 
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

function RILassetManager()
{
    // Set and create download directories
    this.DEFAULT_FOLDER_NAME    = 'ReadItLater';
    this.PAGES_FOLDER_NAME	= 'RIL_pages'; // !!!!! changes here should be checked against RIL.getItemForCurrentPage
    this.ASSETS_FOLDER_NAME	= 'RIL_assets'; // !!!!! changes here should be checked against RIL.getItemForCurrentPage    
}

RILassetManager.prototype =
{
    
    //////////////////////////////////////////////////
      
    init : function()
    {
        // IO service not allowed because it is not threadsafe!
        if (Components)
        {
            this.FILE           = Components.classes["@mozilla.org/file/directory_service;1"].getService(Components.interfaces.nsIProperties);
            this.PREFS          = Components.classes['@ril.ideashower.com/rilprefs;1'].getService().wrappedJSObject;
            this.JSONRef   	= Components.classes["@mozilla.org/dom/json;1"].createInstance(Components.interfaces.nsIJSON);
        
	    var paths = {};
	    paths.PATH_PROF = this.FILE.get("ProfD", Components.interfaces.nsIFile).path;
	    paths.FD        = paths.PATH_PROF.match(/([\/\\])/)[0];
	    paths.PATH_RIL  = this.PREFS.get('offlinePath');
	    paths.PATH_RIL  	 = paths.PATH_RIL ? paths.PATH_RIL : (paths.PATH_PROF + paths.FD + this.DEFAULT_FOLDER_NAME);
	    paths.PATH_PAGES     = paths.PATH_RIL + paths.FD + this.PAGES_FOLDER_NAME;      
	    paths.PATH_ASSETS    = paths.PATH_RIL + paths.FD + this.ASSETS_FOLDER_NAME;	    
	    this.setPaths(paths);
	    
            this.DIR_RIL        = this.dir(this.PATH_RIL, true);        
            this.DIR_PAGES      = this.dir(this.PATH_PAGES, true);
            this.DIR_ASSETS     = this.dir(this.PATH_ASSETS, true);
        }
    },
    
    JSON :
    {
	encode : function(d)
	{
	    return (this.JSONRef) ? this.JSONRef.encode(d) : JSON.stringify(d);
	},
	decode : function(s)
	{
	    return (this.JSONRef) ? this.JSONRef.decode(s) : JSON.parse(s);
	}	    
    },
    
    setPaths : function(data)
    {
	for(var i in data)
	    this[i] = data[i];
		
	this.jsonPaths = this.JSON.encode(data);
    },
    
    getPaths : function()
    {
        if (!Components) return null;	
	return this.jsonPaths;	
    },
    
    file : function(path)
    {
        if (!Components) return null;
        
	var file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
        file.initWithPath(path);
	return file;
    },
    
    dir : function(path, createIfDoesntExist)
    {
        if (!Components) return null;
        
        var file = this.file(path);
        
        if (createIfDoesntExist)
        {
            if (!file.exists() || !file.isDirectory()) file.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0777);
        }
        
        return file;
    },
    
    typeCastTrueFalseNull : function(string)
    {
	return string == 'true' ? true : string == 'false' ? false : string == 'null' || string == 'undefined' ? null : string;
    },

    pathsForLiteral : function( literal, baseURL, relative, forceType )
    {
	// because args come through as strings, need to do some type casting
	baseURL = this.typeCastTrueFalseNull(baseURL);
	relative = this.typeCastTrueFalseNull(relative);
	forceType = this.typeCastTrueFalseNull(forceType);	
	
        try {
	    // Find absolute path
	    var absoluteURI = this.parseUri( literal, baseURL );	    
	    var absolute = absoluteURI.spec;
	    
	    if (absoluteURI.scheme != 'http' && absoluteURI.scheme != 'https') return; // no other schemes allowed
	    
	    // Decode the url (just &amp; right now)
	    absolute = absolute.replace('&amp;', '&');
	    
	    
	    // Fix up the absolute path to use when saving to path
	    // query string data should be moved to file name
	    // Stylesheets should be forced to end in css
	    // ex: img.jpg?test=1 => imgtest%31.jpg
	    // ex: index.php?blah=1 => indexblah%31.css
	    
	    // Fix lastPathComponent as described above
	    var pathParts = absoluteURI.path.split('/');
	    var last = pathParts[ pathParts.length-1 ];
	    
	    // Move query string info into filename
	    if (last)
	    {
		var extension   = absoluteURI.file.replace(/[^\.]*\.(.*)$/, '.$1');		
		var newPath     = last.replace(extension, '');
		newPath         +=  absoluteURI.query ? encodeURIComponent(absoluteURI.query) : '';
		newPath         +=  forceType ? (forceType==2 ? '.css' : '') : extension;
		
		pathParts[ pathParts.length-1 ] = newPath;
	    }
	    
	    var absolutePath = this.cleanPathName( pathParts.join(this.FD) );
	    
	    // Break up path parts to figure out folders
	    pathParts = absolutePath.split(this.FD);
	    
	    // Build Path
	    var assetDomain = absoluteURI.host;
	    var path = this.PATH_ASSETS + this.FD + assetDomain;
	    for(var i in pathParts) {
		if (!pathParts[i]) continue;
		if (pathParts[i].length > 50)
		    pathParts[i] = pathParts[i].substr(0, 50); // make sure no folder will be over file name limits
		path += this.FD + pathParts[i];
		
	    }
	    
	    
	    // -- Moved file exists check out and only used when it needs it -- //
	    
	    
	    // Make relative Path
	    // Remove front end of path (offline directory path)
	    // second replace strips prefix slash if it exists so we don't get ../..//something
	    // relative path should only have forward slashes: file://something/something
	    var relativePath = path.replace( this.PATH_RIL , '' ).replace(new RegExp('^\\'+this.FD), '').replace(/\\/gi, '/');
	    
	    // If the path needs to be relative (for example its linked from inside a stylesheet, add the required number of ../
	    if (relative) {
		var baseItemInfoJSON = this.pathsForLiteral( baseURL, baseURL, false, false );
		if (baseItemInfoJSON)
		{
		    var baseItemInfo = this.JSON.decode(baseItemInfoJSON);
		    var baseItemPathParts = baseItemInfo.assetRelativePath.split('/');
		    
		    var relativePrefix = '';
		    var parts = baseItemPathParts.length - 3; //2 for the ../ added below, and 1 for moving out of current
		    for(var i=0; i<parts; i++)
		    {
			relativePrefix += '../';
		    }
		    relativePath = relativePrefix + relativePath;
		}
		// TODO - what to do for else?
		
	    } else {
		
		// Needs to go out of RIL_pages and into RIL_assets, first ../ gets it out of items folder, second ../ gets it out of RIL_pages
		relativePath = '../../' + relativePath;
		
	    }
	    
	    return this.JSON.encode({
		literal:            literal,
		absolute:           absolute,
		assetPath:          path,
		assetRelativePath:  relativePath,
		assetDomain:        assetDomain,
		assetExists: 	    this.assetExists(path)
	    });
	
	} catch(e) {
	    Components.utils.reportError('Error caused by '+ literal + "\n" + baseURL);
	    Components.utils.reportError(e);
	}
    },
    cleanPathName : function(path)
    {        
        path = path.replace( this.FD=='/' ? /\\/gi : /\//gi, '' ); // opp slash as defined in FD
        return path.replace(/[\=\?\&\%\;\:\*\"\<\>\|]/gi, '');
    },
    
    assetExists : function(assetPath)
    {
        if (!Components) return null;
        
	var file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
        file.initWithPath(assetPath);        
        return file.exists();
    },
    
    // -- //
    
    folderPathForItemId : function(itemId, urlFormat)
    {
	var path = this.PATH_PAGES + this.FD + itemId + this.FD;
	if (urlFormat)
	    return 'file:///' + path.replace(/\\/g,'/');
	else
	    return path;
    },
    
    folderForItemId : function(itemId)
    {        
	return this.file(this.folderPathForItemId(itemId));
    },
    
    removeFolderForItemId : function(itemId)
    {	// TODO is the folder.exists check ness?  Is that a point of slowdown?
        if (!Components) return null;
        
	try
        {
        var folder = this.folderForItemId( itemId );
	if (folder.exists()) folder.remove(true);
        }
        catch(e)
        {
            Components.utils.reportError('Following error occured while trying to remove item #'+itemId);
            Components.utils.reportError(e);
        }
    },
    
    // -- //
    
    removeAssetDomain : function(assetDomain)
    {   // TODO is the folder.exists check ness?  Is that a point of slowdown?
        if (!Components) return null;
        
	try
        {
        var folder = this.file(this.PATH_ASSETS + this.FD + assetDomain);
	if (folder.exists()) folder.remove(true);
        }
        catch(e)
        {
            Components.utils.reportError('Following error occured while trying to remove assetdomain '+assetDomain);
            Components.utils.reportError(e);
        }
    },    
    
    parseUri : function(urlStr, baseURL)
    {		    
        if (urlStr.length > 1250) return; //too long of a url locks browser in parseUri script
        var uri = {};
        
	if (baseURL && !urlStr.match(/^https?:/))
	{
            // if url starts with ./example remove ./
            urlStr = urlStr.replace(/^\.\//, '');
	    
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
	else {
	    uri.wasAbsolute = true;	    
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
    
    // returns an absolute from a relative or false if it already is an absolute
    getAbsoluteFromRelative : function(urlStr, baseURL)
    {
	var parsed = this.parseUri(urlStr, baseURL);
	return !parsed || !parsed.host || parsed.wasAbsolute ? false : parsed.spec;
    }
    
  
};

try
{
    if (Components)
    {
	Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
	
	// properties required for XPCOM registration:
	RILassetManager.prototype.classDescription    = "Pocket Asset Manager Javascript XPCOM Component";
	RILassetManager.prototype.classID             = Components.ID("{99810454-07CB-11E0-8E55-23ADDFD72085}");
	RILassetManager.prototype.contractID          = "@ril.ideashower.com/rilassetmanager;1";
	RILassetManager.prototype.QueryInterface      = XPCOMUtils.generateQI([Components.interfaces.nsIRILassetManager]);
    }
    
    
    /**
    * XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4).
    * XPCOMUtils.generateNSGetModule is for Mozilla 1.9.2 (Firefox 3.6).
    */
    if (XPCOMUtils.generateNSGetFactory)
	var NSGetFactory = XPCOMUtils.generateNSGetFactory([RILassetManager]);
    else
	var NSGetModule = XPCOMUtils.generateNSGetModule([RILassetManager]);
}
catch(e){if (Components)Components.utils.reportError(e);}