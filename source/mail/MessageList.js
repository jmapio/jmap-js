// -------------------------------------------------------------------------- \\
// File: MessageList.js                                                       \\
// Module: MailModel                                                          \\
// Requires: API, Message.js, Thread.js                                       \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP, undefined ) {

var Status = O.Status,
    EMPTY = Status.EMPTY,
    OBSOLETE = Status.OBSOLETE;

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

    Type: JMAP.Message,

    init: function ( options ) {
        this._snippets = {};
        this._snippetsNeeded = [];

        this.messageToThreadId = {};

        MessageList.parent.init.call( this, options );
    },

    // Precondition: All ids are fetched for the window to be checked.
    checkIfWindowIsFetched: function ( index ) {
        var store = this.get( 'store' ),
            Type = this.get( 'Type' ),
            windowSize = this.get( 'windowSize' ),
            list = this._list,
            i = index * windowSize,
            l = Math.min( i + windowSize, this.get( 'length' ) ),
            collapseThreads = this.get( 'collapseThreads' ),
            messageToThreadId = this.messageToThreadId,
            messageId, threadId, thread;
        for ( ; i < l; i += 1 ) {
            messageId = list[i];
            // No message, or out-of-date
            if ( store.getRecordStatus( Type, messageId ) & (EMPTY|OBSOLETE) ) {
                return false;
            }
            if ( collapseThreads ) {
                threadId = messageToThreadId[ messageId ];
                // No thread, or out-of-date
                if ( store.getRecordStatus( JMAP.Thread, threadId ) &
                        (EMPTY|OBSOLETE) ) {
                    return false;
                }
                thread = store.getRecord( JMAP.Thread, threadId );
                return thread.get( 'messages' ).every( isFetched );
            }
        }
        return true;
    },

    sourceWillFetchQuery: function () {
        var req = MessageList.parent.sourceWillFetchQuery.call( this );

        // If we have all the ids already, optimise the loading of the records.
        var store = this.get( 'store' ),
            list = this._list,
            length = this.get( 'length' ),
            collapseThreads = this.get( 'collapseThreads' ),
            messageToThreadId = this.messageToThreadId,
            threadId;

        req.records = req.records.filter( function ( req ) {
            var i = req.start,
                l = i + req.count,
                message, thread;

            if ( length ) {
                l = Math.min( l, length );
            }

            while ( i < l ) {
                var id = list[i];
                if ( id ) {
                    i += 1;
                } else {
                    id = list[ l - 1 ];
                    if ( !id ) { break; }
                    l -= 1;
                }
                // Fetch the Message objects (if not already fetched).
                // If already fetched, fetch the updates
                if ( collapseThreads ) {
                    threadId = messageToThreadId[ id ];
                    thread = store.getRecord( JMAP.Thread, threadId );
                    // If already fetched, fetch the updates
                    refresh( thread );
                    thread.get( 'messages' ).forEach( refresh );
                } else {
                    message = store.getRecord( JMAP.Message, id );
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
        var filter = query.get( 'filter' ),
            sort = query.get( 'sort' ),
            collapseThreads = query.get( 'collapseThreads' ),
            canGetDeltaUpdates = query.get( 'canGetDeltaUpdates' ),
            state = query.get( 'state' ),
            request = query.sourceWillFetchQuery(),
            hasMadeRequest = false;

        if ( canGetDeltaUpdates && state && request.refresh ) {
            var list = query._list,
                length = list.length,
                upto = ( length === query.get( 'length' ) ) ?
                    undefined : list[ length - 1 ];
            this.callMethod( 'getMessageListUpdates', {
                filter: filter,
                sort: sort,
                collapseThreads: collapseThreads,
                sinceState: state,
                uptoMessageId: upto,
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
            get( 0, 30, undefined, undefined, true );
        }
    },

    // ---

    messageList: function ( args ) {
        var store = this.get( 'store' ),
            query = store.getQuery( getId( args ) ),
            messageToThreadId, messageIds, threadIds, l;

        if ( query &&
                args.collapseThreads === query.get( 'collapseThreads' ) ) {
            messageToThreadId = query.messageToThreadId;
            threadIds = args.threadIds;
            messageIds = args.idList = args.messageIds;
            l = messageIds.length;
            while ( l-- ) {
                messageToThreadId[ messageIds[l] ] = threadIds[l];
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
        var store = this.get( 'store' ),
            query = store.getQuery( getId( args ) ),
            messageToThreadId;

        if ( query &&
                args.collapseThreads === query.get( 'collapseThreads' ) ) {
            messageToThreadId = query.messageToThreadId;
            args.upto = args.uptoMessageId;
            args.removed = args.removed.map( function ( obj ) {
                delete messageToThreadId[ obj.messageId ];
                return obj.messageId;
            });
            args.added = args.added.map( function ( obj ) {
                messageToThreadId[ obj.messageId ] = obj.threadId;
                return [ obj.index, obj.messageId ];
            });
            query.sourceDidFetchUpdate( args );
        }
    },

    error_getMessageListUpdates_cannotCalculateChanges: function () {
        this.response.error_getMessageListUpdates_tooManyChanges.call( this );
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

MessageList.getId = getId;

JMAP.MessageList = MessageList;

}( JMAP ) );
