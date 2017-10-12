// -------------------------------------------------------------------------- \\
// File: MessageList.js                                                       \\
// Module: MailModel                                                          \\
// Requires: API, Message.js, Thread.js                                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP, JSON */

'use strict';

( function ( JMAP, undefined ) {

var isEqual = O.isEqual;
var Status = O.Status;
var EMPTY = Status.EMPTY;
var OBSOLETE = Status.OBSOLETE;

var Message = JMAP.Message;
var Thread = JMAP.Thread;

var isFetched = function ( message ) {
    return !message.is( EMPTY|OBSOLETE );
};
var refresh = function ( record ) {
    if ( record.is( OBSOLETE ) ) {
        record.refresh();
    }
};

var EMPTY_SNIPPET = {
    body: ' '
};

var stringifySorted = function ( item ) {
    if ( !item || ( typeof item !== 'object' ) ) {
        return JSON.stringify( item );
    }
    if ( item instanceof Array ) {
        return '[' + item.map( stringifySorted ).join( ',' ) + ']';
    }
    var keys = Object.keys( item );
    keys.sort();
    return '{' + keys.map( function ( key ) {
        return '"' + key + '":' + stringifySorted( item[ key ] );
    }).join( ',' ) + '}';
};

var getId = function ( args ) {
    return 'ml:' + stringifySorted( args.filter ) +
        ( args.collapseThreads ? '+' : '-' );
};

var MessageList = O.Class({

    Extends: O.WindowedRemoteQuery,

    optimiseFetching: true,

    sort: [ 'date desc' ],
    collapseThreads: true,

    Type: Message,

    init: function ( options ) {
        this._snippets = {};
        this._snippetsNeeded = [];

        this.messageToThreadSK = {};

        MessageList.parent.constructor.call( this, options );
    },

    // Precondition: All ids are fetched for the window to be checked.
    checkIfWindowIsFetched: function ( index ) {
        var store = this.get( 'store' );
        var windowSize = this.get( 'windowSize' );
        var list = this._list;
        var i = index * windowSize;
        var l = Math.min( i + windowSize, this.get( 'length' ) );
        var collapseThreads = this.get( 'collapseThreads' );
        var messageToThreadSK = this.messageToThreadSK;
        var messageSK, threadSK, thread;
        for ( ; i < l; i += 1 ) {
            messageSK = list[i];
            // No message, or out-of-date
            if ( store.getStatus( messageSK ) & (EMPTY|OBSOLETE) ) {
                return false;
            }
            if ( collapseThreads ) {
                threadSK = messageToThreadSK[ messageSK ];
                // No thread, or out-of-date
                if ( store.getStatus( Thread, threadSK ) & (EMPTY|OBSOLETE) ) {
                    return false;
                }
                thread = store.getRecord( Thread, '#' + threadSK );
                return thread.get( 'messages' ).every( isFetched );
            }
        }
        return true;
    },

    sourceWillFetchQuery: function () {
        var req = MessageList.parent.sourceWillFetchQuery.call( this );

        // If we have all the ids already, optimise the loading of the records.
        var store = this.get( 'store' );
        var list = this._list;
        var length = this.get( 'length' );
        var collapseThreads = this.get( 'collapseThreads' );
        var messageToThreadSK = this.messageToThreadSK;

        req.records = req.records.filter( function ( req ) {
            var i = req.start;
            var l = i + req.count;
            var message, thread, messageSK, threadSK;

            if ( length ) {
                l = Math.min( l, length );
            }

            while ( i < l ) {
                messageSK = list[i];
                if ( messageSK ) {
                    i += 1;
                } else {
                    messageSK = list[ l - 1 ];
                    if ( !messageSK ) { break; }
                    l -= 1;
                }
                // Fetch the Message objects (if not already fetched).
                // If already fetched, fetch the updates
                if ( collapseThreads ) {
                    threadSK = messageToThreadSK[ messageSK ];
                    thread = store.getRecord( Thread, '#' + threadSK );
                    // If already fetched, fetch the updates
                    refresh( thread );
                    thread.get( 'messages' ).forEach( refresh );
                } else {
                    message = store.getRecord( Message, '#' + messageSK );
                    refresh( message );
                }
            }
            req.start = i;
            req.count = l - i;
            return i !== l;
        });

        return req;
    },

    // --- Snippets ---

    sourceDidFetchSnippets: function ( snippets ) {
        var store = JMAP.store,
            Message = JMAP.Message,
            READY = O.Status.READY,
            l = snippets.length,
            snippet, messageId;
        while ( l-- ) {
            snippet = snippets[l];
            messageId = snippet.messageId;
            this._snippets[ messageId ] = snippet;
            if ( store.getRecordStatus( Message, messageId ) & READY ) {
                // There is no "snippet" property, but this triggers the
                // observers of * property changes on the object.
                store.getRecord( Message, messageId )
                     .propertyDidChange( 'snippet' );
            }
        }
    },

    getSnippet: function ( messageId ) {
        var snippet = this._snippets[ messageId ];
        if ( !snippet ) {
            this._snippetsNeeded.push( messageId );
            this._snippets[ messageId ] = snippet = EMPTY_SNIPPET;
            this.fetchSnippets();
        }
        return snippet;
    },

    fetchSnippets: function () {
        JMAP.mail.callMethod( 'getSearchSnippets', {
            messageIds: this._snippetsNeeded,
            filter: this.get( 'filter' ),
            // Not part of the getSearchSnippets call, but needed to identify
            // this list again to give the response to.
            collapseThreads: this.get( 'collapseThreads' )
        });
        this._snippetsNeeded = [];
    }.queue( 'after' )
});

JMAP.mail.handle( MessageList, {
    query: function ( query ) {
        var filter = query.get( 'filter' );
        var sort = query.get( 'sort' );
        var collapseThreads = query.get( 'collapseThreads' );
        var canGetDeltaUpdates = query.get( 'canGetDeltaUpdates' );
        var state = query.get( 'state' );
        var request = query.sourceWillFetchQuery();
        var hasMadeRequest = false;

        if ( canGetDeltaUpdates && state && request.refresh ) {
            var list = query._list;
            var length = list.length;
            var upto = ( length === query.get( 'length' ) ) ?
                    undefined : list[ length - 1 ];
            this.callMethod( 'getMessageListUpdates', {
                filter: filter,
                sort: sort,
                collapseThreads: collapseThreads,
                sinceState: state,
                uptoMessageId: upto ?
                    JMAP.store.getIdFromStoreKey( upto ) : null,
                maxChanges: 250
            });
        }

        if ( request.callback ) {
            this.addCallback( request.callback );
        }

        var get = function ( start, count, anchor, offset, fetchData ) {
            hasMadeRequest = true;
            this.callMethod( 'getMessageList', {
                filter: filter,
                sort: sort,
                collapseThreads: collapseThreads,
                position: start,
                anchor: anchor,
                anchorOffset: offset,
                limit: count,
                fetchThreads: collapseThreads && fetchData,
                fetchMessages: fetchData,
                fetchMessageProperties: fetchData ?
                    JMAP.Message.headerProperties : null,
                fetchSearchSnippets: false
            });
        }.bind( this );

        request.ids.forEach( function ( req ) {
            get( req.start, req.count, undefined, undefined, false );
        });
        request.records.forEach( function ( req ) {
            get( req.start, req.count, undefined, undefined, true );
        });
        request.indexOf.forEach( function ( req ) {
            get( undefined, 5, req[0], 1, false );
            this.addCallback( req[1] );
        }, this );

        if ( ( ( query.get( 'status' ) & O.Status.EMPTY ) &&
                !request.records.length ) ||
             ( !canGetDeltaUpdates && !hasMadeRequest && request.refresh ) ) {
            get( 0, query.get( 'windowSize' ), undefined, undefined, true );
        }
    },

    // ---

    messageList: function ( args ) {
        var store = this.get( 'store' );
        var query = store.getQuery( getId( args ) );
        var messageToThreadSK, messageIds, threadIds, l;

        args.filter = args.filter || null;
        args.sort = args.sort || null;

        if ( query &&
                args.collapseThreads === query.get( 'collapseThreads' ) &&
                isEqual( args.sort, query.get( 'sort' ) ) &&
                isEqual( args.filter, query.get( 'filter' ) ) ) {
            if ( !args.canCalculateUpdates &&
                    args.state !== query.get( 'state' ) ) {
                query.messageToThreadSK = {};
            }
            messageToThreadSK = query.messageToThreadSK;
            threadIds = args.threadIds;
            messageIds = args.idList = args.messageIds;
            l = messageIds.length;
            while ( l-- ) {
                messageToThreadSK[
                    store.getStoreKey( Message, messageIds[l] )
                ] = store.getStoreKey( Thread, threadIds[l] );
            }
            query.set( 'canGetDeltaUpdates', args.canCalculateUpdates );
            query.sourceDidFetchIdList( args );
        }
    },

    error_getMessageList_anchorNotFound: function (/* args */) {
        // Don't need to do anything; it's only used for doing indexOf,
        // and it will just check that it doesn't have it.
    },

    messageListUpdates: function ( args ) {
        var store = this.get( 'store' );
        var query = store.getQuery( getId( args ) );
        var messageToThreadSK;

        args.filter = args.filter || null;
        args.sort = args.sort || null;
        args.removed = args.removed || [];
        args.added = args.added || [];

        if ( query &&
                args.collapseThreads === query.get( 'collapseThreads' ) ) {
            messageToThreadSK = query.messageToThreadSK;
            args.upto = args.uptoMessageId;
            args.removed = args.removed.map( function ( obj ) {
                var messageId = obj.messageId;
                delete messageToThreadSK[
                    store.getStoreKey( Message, messageId )
                ];
                return messageId;
            });
            args.added = args.added.map( function ( obj ) {
                var messageId = obj.messageId;
                messageToThreadSK[
                    store.getStoreKey( Message, messageId )
                ] = store.getStoreKey( Thread, obj.threadId );
                return [ obj.index, messageId ];
            });
            query.sourceDidFetchUpdate( args );
        }
    },

    error_getMessageListUpdates_cannotCalculateChanges: function ( _, __, requestArgs ) {
        this.response.error_getMessageListUpdates_tooManyChanges
            .call( this,  _, __, requestArgs );
    },

    error_getMessageListUpdates_tooManyChanges: function ( _, __, requestArgs ) {
        var query = this.get( 'store' ).getQuery( getId( requestArgs ) );
        if ( query ) {
            query.reset();
        }
    },

    // ---

    searchSnippets: function ( args ) {
        var store = this.get( 'store' ),
            query = store.getQuery( getId( args ) );
        if ( query ) {
            query.sourceDidFetchSnippets( args.list );
        }
    }
});

JMAP.mail.recalculateAllFetchedWindows = function () {
    // Mark all message lists as needing to recheck if window is fetched.
    this.get( 'store' ).getAllRemoteQueries().forEach( function ( query ) {
        if ( query instanceof MessageList ) {
            query.recalculateFetchedWindows();
        }
    });
};

MessageList.getId = getId;

JMAP.MessageList = MessageList;

}( JMAP ) );
