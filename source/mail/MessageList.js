// -------------------------------------------------------------------------- \\
// File: MessageList.js                                                       \\
// Module: MailModel                                                          \\
// Requires: API, Message.js, Thread.js                                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const Class = O.Class;
const WindowedQuery = O.WindowedQuery;
const isEqual = O.isEqual;
const Status = O.Status;
const EMPTY = Status.EMPTY;
const READY = Status.READY;
const NEW = Status.NEW;
const OBSOLETE = Status.OBSOLETE;
const LOADING = Status.LOADING;

const getQueryId = JMAP.getQueryId;
const Message = JMAP.Message;

// ---

const statusIsFetched = function ( store, storeKey ) {
    var status = store.getStatus( storeKey );
    return ( status & READY ) &&
        ( !( status & OBSOLETE ) || ( status & LOADING ) );
};
const refreshIfNeeded = function ( record ) {
    const status = record.get( 'status' );
    if ( ( status & OBSOLETE ) && !( status & LOADING ) ) {
        record.fetch();
    }
};

const EMPTY_SNIPPET = {
    body: ' ',
};

const getId = function ( args ) {
    return getQueryId( Message, args ) + ( args.collapseThreads ? '+' : '-' );
};

const MessageList = Class({

    Extends: WindowedQuery,

    optimiseFetching: true,

    sort: [{ property: 'receivedAt', isAscending: false }],
    collapseThreads: true,
    findAllInThread: false,

    Type: Message,

    init: function ( options ) {
        this._snippets = {};
        this._snippetsNeeded = [];

        this.threadIdToEmailIds = {};

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
        var messageSK, threadSK, thread;
        for ( ; i < l; i += 1 ) {
            messageSK = storeKeys[i];
            // No message, or out-of-date
            if ( !messageSK || !statusIsFetched( store, messageSK ) ) {
                return false;
            }
            if ( collapseThreads ) {
                threadSK = store.getRecordFromStoreKey( messageSK )
                                .getData()
                                .threadId;
                // No thread, or out-of-date
                if ( !statusIsFetched( store, threadSK ) ) {
                    return false;
                }
                thread = store.getRecordFromStoreKey( threadSK );
                if ( !thread.getData().emailIds.every(
                        statusIsFetched.bind( null, store ) ) ) {
                    return false;
                }
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
            var message, thread, messageSK, status;

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
                    status = store.getStatus( messageSK );
                    // If it's a draft pre-emptively added to the message
                    // list, ignore it
                    if ( status & NEW ) {
                        continue;
                    }
                    if ( status & READY ) {
                        thread = store.getRecordFromStoreKey( messageSK )
                                      .get( 'thread' );
                        // If already fetched, fetch the updates
                        refreshIfNeeded( thread );
                        thread.get( 'messages' ).forEach( refreshIfNeeded );
                    } else {
                        JMAP.mail.fetchRecord(
                            store.getAccountIdFromStoreKey( messageSK ),
                            Message.Thread,
                            store.getIdFromStoreKey( messageSK )
                        );
                    }
                } else {
                    message = store.getRecordFromStoreKey( messageSK );
                    refreshIfNeeded( message );
                }
            }
            req.start = i;
            req.count = l - i;
            return i !== l;
        });

        return req;
    },

    // --- Snippets ---

    sourceDidFetchSnippets: function ( accountId, snippets ) {
        var store = this.get( 'store' );
        var l = snippets.length;
        var snippet, emailId;
        while ( l-- ) {
            snippet = snippets[l];
            emailId = snippet.emailId;
            this._snippets[ emailId ] = snippet;
            if ( store.getRecordStatus(
                    accountId, Message, emailId ) & READY ) {
                // There is no "snippet" property, but this triggers the
                // observers of * property changes on the object.
                store.getRecord( accountId, Message, emailId )
                     .propertyDidChange( 'snippet' );
            }
        }
    },

    getSnippet: function ( emailId ) {
        var snippet = this._snippets[ emailId ];
        if ( !snippet ) {
            this._snippetsNeeded.push( emailId );
            this._snippets[ emailId ] = snippet = EMPTY_SNIPPET;
            this.fetchSnippets();
        }
        return snippet;
    },

    fetchSnippets: function () {
        JMAP.mail.callMethod( 'SearchSnippet/get', {
            accountId: this.get( 'accountId' ),
            emailIds: this._snippetsNeeded,
            filter: this.get( 'where' ),
        });
        this._snippetsNeeded = [];
    }.queue( 'after' )
});
MessageList.getId = getId;

JMAP.mail.handle( MessageList, {
    query: function ( query ) {
        var accountId = query.get( 'accountId' );
        var where = query.get( 'where' );
        var sort = query.get( 'sort' );
        var collapseThreads = query.get( 'collapseThreads' );
        var findAllInThread = query.get( 'findAllInThread' );
        var canGetDeltaUpdates = query.get( 'canGetDeltaUpdates' );
        var queryState = query.get( 'queryState' );
        var request = query.sourceWillFetchQuery();
        var refresh = request.refresh;
        var hasMadeRequest = false;
        var isEmpty = ( query.get( 'status' ) & EMPTY );

        var fetchThreads = function () {
            this.callMethod( 'Thread/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Email/get',
                    path: '/list/*/threadId',
                },
            });
            this.callMethod( 'Email/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Thread/get',
                    path: '/list/*/emailIds',
                },
                properties: Message.headerProperties,
            });
        }.bind( this );

        if ( canGetDeltaUpdates && queryState && refresh ) {
            var storeKeys = query.getStoreKeys();
            var length = storeKeys.length;
            var upToId = ( length === query.get( 'length' ) ) ?
                    undefined : storeKeys[ length - 1 ];
            this.callMethod( 'Email/queryChanges', {
                accountId: accountId,
                filter: where,
                sort: sort,
                collapseThreads: collapseThreads,
                findAllInThread: findAllInThread || undefined,
                sinceQueryState: queryState,
                upToId: upToId ?
                    this.get( 'store' ).getIdFromStoreKey( upToId ) : null,
                maxChanges: 25,
                calculateTotal: true,
            });
            this.callMethod( 'Email/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    name: 'Email/queryChanges',
                    path: '/added/*/id',
                },
                properties: collapseThreads ?
                    [ 'threadId' ] : Message.headerProperties,
            });
            if ( collapseThreads ) {
                fetchThreads();
            }
        }

        if ( request.callback ) {
            this.addCallback( request.callback );
        }

        var calculateTotal = !!( where && where.inMailbox ) ||
            ( !isEmpty && !query.get( 'hasTotal' ) ) ||
            ( !canGetDeltaUpdates && !!refresh );
        var get = function ( start, count, anchor, offset, fetchData ) {
            this.callMethod( 'Email/query', {
                accountId: accountId,
                filter: where,
                sort: sort,
                collapseThreads: collapseThreads,
                findAllInThread: findAllInThread || undefined,
                position: start,
                anchor: anchor,
                anchorOffset: offset,
                limit: count,
                calculateTotal: calculateTotal,
            });
            hasMadeRequest = true;
            calculateTotal = false;
            if ( fetchData ) {
                this.callMethod( 'Email/get', {
                    accountId: accountId,
                    '#ids': {
                        resultOf: this.getPreviousMethodId(),
                        name: 'Email/query',
                        path: '/ids',
                    },
                    properties: collapseThreads ?
                        [ 'threadId' ] : Message.headerProperties,
                });
                if ( collapseThreads ) {
                    fetchThreads();
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
            get( undefined, 1, req[0], 0, false );
            this.addCallback( req[1] );
        }, this );

        if ( ( isEmpty && !request.records.length ) ||
             ( !canGetDeltaUpdates && !hasMadeRequest && refresh ) ) {
            get( 0, query.get( 'windowSize' ), undefined, undefined, true );
        }
    },

    // ---

    'Email/query': function ( args, _, reqArgs ) {
        const query = this.get( 'store' ).getQuery( getId( reqArgs ) );
        var total, hasTotal, numIds, threadIdToEmailIds;
        if ( query ) {
            if ( args.total === undefined ) {
                total = query.get( 'length' );
                hasTotal = query.get( 'hasTotal' ) && total !== null;
                if ( !hasTotal ) {
                    numIds = args.ids.length;
                    total = args.position + numIds;
                    if ( numIds < reqArgs.limit ) {
                        hasTotal = true;
                    } else {
                        total += 1;
                    }
                }
                args.total = total;
            } else {
                hasTotal = true;
            }
            threadIdToEmailIds = args.threadIdToEmailIds;
            if ( threadIdToEmailIds ) {
                Object.assign( query.threadIdToEmailIds, threadIdToEmailIds );
            }
            query.set( 'error', null );
            query.set( 'hasTotal', hasTotal );
            query.set( 'canGetDeltaUpdates', args.canCalculateChanges );
            query.sourceDidFetchIds( args );
        }
    },

    // We don't care if the anchor isn't found - this was just looking for an
    // index, and this means it's not in the query.
    'error_Email/query_anchorNotFound': function () {},

    // Any other error,
    // e.g. unsupportedFilter, unsupportedSort, invalidArguments etc.
    'error_Email/query': function ( args, requestName, requestArgs ) {
        var query = this.get( 'store' ).getQuery( getId( requestArgs ) );
        if ( query ) {
            query.set( 'error', args.type );
            query.sourceDidFetchIds({
                ids: [],
                position: 0,
                total: 0,
            });
        }
    },

    'Email/queryChanges': function ( args, _, reqArgs ) {
        const query = this.get( 'store' ).getQuery( getId( reqArgs ) );
        if ( query ) {
            const threadIdToEmailIds = args.threadIdToEmailIds;
            if ( threadIdToEmailIds ) {
                Object.assign( query.threadIdToEmailIds, threadIdToEmailIds );
            }
            args.upToId = reqArgs.upToId;
            query.sourceDidFetchUpdate( args );
        }
    },

    'error_Email/queryChanges_tooManyChanges': function ( args, requestName, requestArgs ) {
        if ( requestArgs.maxChanges === 25 ) {
            // Try again without fetching the emails
            this.callMethod( 'Email/queryChanges',
                Object.assign( {}, requestArgs, {
                    maxChanges: 250,
                })
            );
        } else {
            this.response[ 'error_Email/queryChanges' ]
                .call( this, args, requestName, requestArgs );
        }
    },

    // Any other error, e.g. cannotCalculateChanges, invalidArguments etc.
    'error_Email/queryChanges': function ( _, __, reqArgs ) {
        var query = this.get( 'store' ).getQuery( getId( reqArgs ) );
        if ( query ) {
            query.reset();
        }
    },

    // ---

    'SearchSnippet/get': function ( args, _, reqArgs ) {
        var store = this.get( 'store' );
        var where = reqArgs.filter;
        var list = args.list;
        var accountId = args.accountId;
        store.getAllQueries().forEach( function ( query ) {
            if ( isEqual( query.get( 'where' ), where ) ) {
                query.sourceDidFetchSnippets( accountId, list );
            }
        });
    },
});

JMAP.mail.recalculateAllFetchedWindows = function () {
    // Mark all message lists as needing to recheck if window is fetched.
    this.get( 'store' ).getAllQueries().forEach( function ( query ) {
        if ( query instanceof MessageList ) {
            query.recalculateFetchedWindows();
        }
    });
};

// --- Export

JMAP.MessageList = MessageList;

}( JMAP ) );
