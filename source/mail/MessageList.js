// -------------------------------------------------------------------------- \\
// File: MessageList.js                                                       \\
// Module: MailModel                                                          \\
// Requires: API, Message.js, Thread.js                                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP, JSON */

'use strict';

( function ( JMAP, undefined ) {

const Status = O.Status;
const EMPTY = Status.EMPTY;
const READY = Status.READY;
const OBSOLETE = Status.OBSOLETE;

const Message = JMAP.Message;
const Thread = JMAP.Thread;

// ---

const isFetched = function ( message ) {
    return !message.is( EMPTY|OBSOLETE );
};
const refresh = function ( record ) {
    if ( record.is( OBSOLETE ) ) {
        record.fetch();
    }
};

const EMPTY_SNIPPET = {
    body: ' '
};

const stringifySorted = function ( item ) {
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

const getId = function ( args ) {
    return 'ml:' + stringifySorted( args.where || args.filter ) + ':' +
        JSON.stringify( args.sort ) +
        ( args.collapseThreads ? '+' : '-' );
};

const MessageList = O.Class({

    Extends: O.WindowedQuery,

    optimiseFetching: true,

    sort: [ 'date desc' ],
    collapseThreads: true,

    Type: Message,

    init: function ( options ) {
        this._snippets = {};
        this._snippetsNeeded = [];

        MessageList.parent.constructor.call( this, options );
    },

    // Precondition: All ids are fetched for the window to be checked.
    checkIfWindowIsFetched: function ( index ) {
        var store = this.get( 'store' );
        var windowSize = this.get( 'windowSize' );
        var storeKeys = this.getStoreKeys();
        var i = index * windowSize;
        var l = Math.min( i + windowSize, this.get( 'length' ) );
        var collapseThreads = this.get( 'collapseThreads' );
        var messageSK, threadId, threadSK, thread;
        for ( ; i < l; i += 1 ) {
            messageSK = storeKeys[i];
            // No message, or out-of-date
            if ( store.getStatus( messageSK ) & (EMPTY|OBSOLETE) ) {
                return false;
            }
            if ( collapseThreads ) {
                threadId = store.getRecordFromStoreKey( messageSK )
                                .get( 'threadId' );
                threadSK = store.getStoreKey( Thread, threadId );
                // No thread, or out-of-date
                if ( store.getStatus( threadSK ) & (EMPTY|OBSOLETE) ) {
                    return false;
                }
                thread = store.getRecordFromStoreKey( threadSK );
                return thread.get( 'messages' ).every( isFetched );
            }
        }
        return true;
    },

    sourceWillFetchQuery: function () {
        var req = MessageList.parent.sourceWillFetchQuery.call( this );

        // If we have all the ids already, optimise the loading of the records.
        var store = this.get( 'store' );
        var storeKeys = this.getStoreKeys();
        var length = this.get( 'length' );
        var collapseThreads = this.get( 'collapseThreads' );

        req.records = req.records.filter( function ( req ) {
            var i = req.start;
            var l = i + req.count;
            var message, thread, messageSK;

            if ( length ) {
                l = Math.min( l, length );
            }

            while ( i < l ) {
                messageSK = storeKeys[i];
                if ( messageSK ) {
                    i += 1;
                } else {
                    messageSK = storeKeys[ l - 1 ];
                    if ( !messageSK ) { break; }
                    l -= 1;
                }
                // Fetch the Message objects (if not already fetched).
                // If already fetched, fetch the updates
                if ( collapseThreads ) {
                    if ( store.getStatus( messageSK ) & READY ) {
                        thread = store.getRecordFromStoreKey( messageSK )
                                      .get( 'thread' );
                        // If already fetched, fetch the updates
                        refresh( thread );
                        thread.get( 'messages' ).forEach( refresh );
                    } else {
                        JMAP.mail.fetchRecord( Message.Thread,
                            store.getIdFromStoreKey( messageSK ) );
                    }
                } else {
                    message = store.getRecordFromStoreKey( messageSK );
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
            filter: this.get( 'where' ),
            // Not part of the getSearchSnippets call, but needed to identify
            // this list again to give the response to.
            collapseThreads: this.get( 'collapseThreads' )
        });
        this._snippetsNeeded = [];
    }.queue( 'after' )
});

JMAP.mail.handle( MessageList, {
    query: function ( query ) {
        var where = query.get( 'where' );
        var sort = query.get( 'sort' );
        var collapseThreads = query.get( 'collapseThreads' );
        var canGetDeltaUpdates = query.get( 'canGetDeltaUpdates' );
        var state = query.get( 'state' );
        var request = query.sourceWillFetchQuery();
        var hasMadeRequest = false;

        if ( canGetDeltaUpdates && state && request.refresh ) {
            var storeKeys = query.getStoreKeys();
            var length = storeKeys.length;
            var upto = ( length === query.get( 'length' ) ) ?
                    undefined : storeKeys[ length - 1 ];
            this.callMethod( 'getMessageListUpdates', {
                filter: where,
                sort: sort,
                collapseThreads: collapseThreads,
                sinceState: state,
                uptoId: upto ?
                    JMAP.store.getIdFromStoreKey( upto ) : null,
                maxChanges: 250,
            });
        }

        if ( request.callback ) {
            this.addCallback( request.callback );
        }

        var get = function ( start, count, anchor, offset, fetchData ) {
            hasMadeRequest = true;
            this.callMethod( 'getMessageList', {
                filter: where,
                sort: sort,
                collapseThreads: collapseThreads,
                position: start,
                anchor: anchor,
                anchorOffset: offset,
                limit: count,
            });
            if ( fetchData ) {
                this.callMethod( 'getMessages', {
                    '#ids': {
                        resultOf: this.getPreviousMethodId(),
                        path: '/ids',
                    },
                    properties: collapseThreads ?
                        [ 'threadId' ] : Message.headerProperties,
                });
                if ( collapseThreads ) {
                    this.callMethod( 'getThreads', {
                        '#ids': {
                            resultOf: this.getPreviousMethodId(),
                            path: '/list/*/threadId',
                        },
                    });
                    this.callMethod( 'getMessages', {
                        '#ids': {
                            resultOf: this.getPreviousMethodId(),
                            path: '/list/*/messageIds',
                        },
                        properties: Message.headerProperties
                    });
                }
            }
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
        args.filter = args.filter || null;
        args.sort = args.sort || null;
        args.idList = args.ids;

        var store = this.get( 'store' );
        var query = store.getQuery( getId( args ) );

        if ( query ) {
            query.set( 'canGetDeltaUpdates', args.canCalculateUpdates );
            query.sourceDidFetchIdList( args );
        }
    },

    error_getMessageList_anchorNotFound: function (/* args */) {
        // Don't need to do anything; it's only used for doing indexOf,
        // and it will just check that it doesn't have it.
    },

    messageListUpdates: function ( args ) {
        args.filter = args.filter || null;
        args.sort = args.sort || null;
        args.removed = args.removed || [];
        args.added = args.added ? args.added.map( function ( item ) {
            return [ item.index, item.id ];
        }) : [];
        args.upto = args.uptoId;

        var store = this.get( 'store' );
        var query = store.getQuery( getId( args ) );

        if ( query ) {
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
        var store = this.get( 'store' );
        var query = store.getQuery( getId( args ) );

        if ( query ) {
            query.sourceDidFetchSnippets( args.list );
        }
    }
});

JMAP.mail.recalculateAllFetchedWindows = function () {
    // Mark all message lists as needing to recheck if window is fetched.
    this.get( 'store' ).getAllQueries().forEach( function ( query ) {
        if ( query instanceof MessageList ) {
            query.recalculateFetchedWindows();
        }
    });
};

MessageList.getId = getId;

JMAP.MessageList = MessageList;

}( JMAP ) );
