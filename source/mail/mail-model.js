// -------------------------------------------------------------------------- \\
// File: mail-model.js                                                        \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js, Thread.js, Message.js, MessageList.js, MessageSubmission.js \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const clone = O.clone;
const isEqual = O.isEqual;
const READY = O.Status.READY;

const auth = JMAP.auth;
const store = JMAP.store;
const connection = JMAP.mail;
const Mailbox = JMAP.Mailbox;
const Thread = JMAP.Thread;
const Message = JMAP.Message;
const MessageList = JMAP.MessageList;
const MessageSubmission = JMAP.MessageSubmission;
const SnoozeDetails = JMAP.SnoozeDetails;

// --- Preemptive mailbox count updates ---

const getMailboxDelta = function ( deltas, mailboxSK ) {
    return deltas[ mailboxSK ] || ( deltas[ mailboxSK ] = {
        totalEmails: 0,
        unreadEmails: 0,
        totalThreads: 0,
        unreadThreads: 0,
        removed: [],
        added: []
    });
};

const updateMailboxCounts = function ( mailboxDeltas ) {
    var ignoreCountsForMailboxIds = connection.ignoreCountsForMailboxIds;
    var mailboxSK, delta, mailbox;
    for ( mailboxSK in mailboxDeltas ) {
        delta = mailboxDeltas[ mailboxSK ];
        mailbox = store.getRecordFromStoreKey( mailboxSK );
        if ( delta.totalEmails ) {
            mailbox.set( 'totalEmails', Math.max( 0,
                mailbox.get( 'totalEmails' ) + delta.totalEmails ) );
        }
        if ( delta.unreadEmails ) {
            mailbox.set( 'unreadEmails', Math.max( 0,
                mailbox.get( 'unreadEmails' ) + delta.unreadEmails ) );
        }
        if ( delta.totalThreads ) {
            mailbox.set( 'totalThreads', Math.max( 0,
                mailbox.get( 'totalThreads' ) + delta.totalThreads ) );
        }
        if ( delta.unreadThreads ) {
            mailbox.set( 'unreadThreads', Math.max( 0,
                mailbox.get( 'unreadThreads' ) + delta.unreadThreads ) );
        }
        if ( !connection.get( 'inFlightRequest' ) ) {
            // Fetch the real counts, just in case.
            mailbox.fetch();
        } else {
            // The mailbox may currently be loading; if it loads, it will have
            // data from before this pre-emptive change was made. We need to
            // ignore that and load it again.
            if ( !ignoreCountsForMailboxIds ) {
                connection.ignoreCountsForMailboxIds =
                    ignoreCountsForMailboxIds = {};
                connection.get( 'inFlightCallbacks' )
                    .push([ '', connection.fetchIgnoredMailboxes ]);
            }
            ignoreCountsForMailboxIds[
                mailbox.get( 'accountId' ) + '/' + mailbox.get( 'id' )
            ] = mailbox;
        }
    }
};

// --- Preemptive query updates ---

const isSortedOnKeyword = function ( keyword, sort ) {
    for ( var i = 0, l = sort.length; i < l; i += 1 ) {
        if ( sort[i].keyword === keyword ) {
            return true;
        }
    }
    return false;
};

const isSortedOnUnread = isSortedOnKeyword.bind( null, '$seen' );

const filterHasKeyword = function ( filter, keyword ) {
    return (
        keyword === filter.allInThreadHaveKeyword ||
        keyword === filter.someInThreadHaveKeyword ||
        keyword === filter.noneInThreadHaveKeyword ||
        keyword === filter.hasKeyword ||
        keyword === filter.notKeyword
    );
};

const isFilteredOnUnread = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnUnread );
    }
    return filterHasKeyword( filter, '$seen' );
};

const isFilteredOnKeyword = function ( keyword, filter ) {
    if ( filter.operator ) {
        return filter.conditions.some(
            isFilteredOnKeyword.bind( null, keyword )
        );
    }
    return filterHasKeyword( filter, keyword );
};

const isFilteredOnMailboxes = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnMailboxes );
    }
    return ( 'inMailbox' in filter ) || ( 'inMailboxOtherThan' in filter );
};

const isFilteredJustOnMailbox = function ( filter ) {
    var isJustMailboxes = false;
    var term;
    for ( term in filter ) {
        if ( term === 'inMailbox' ) {
            isJustMailboxes = true;
        } else {
            isJustMailboxes = false;
            break;
        }
    }
    return isJustMailboxes;
};
const returnTrue = function () {
    return true;
};
const returnFalse = function () {
    return false;
};

// ---

const getInboxId = function ( accountId ) {
    const inbox = getMailboxForRole( accountId, 'inbox' );
    return inbox ? inbox.get( 'id' ) : '';
};

const reOrFwd = /^(?:(?:re|fwd):\s*)+/;
const comparators = {
    id: function ( a, b ) {
        var aId = a.get( 'id' );
        var bId = b.get( 'id' );

        return aId < bId ? -1 : aId > bId ? 1 : 0;
    },
    receivedAt: function ( a, b ) {
        return a.get( 'receivedAt' ) - b.get( 'receivedAt' );
    },
    snoozedUntil: function ( a, b, field ) {
        var aSnoozed = a.get( 'snoozed' );
        var bSnoozed = b.get( 'snoozed' );
        var mailboxId = field.mailboxId;
        return (
            aSnoozed && ( !mailboxId || (
                a.isIn( 'snoozed' ) ||
                mailboxId === (
                    aSnoozed.moveToMailboxId ||
                    getInboxId( a.get( 'accountId' ) )
                )
            )) ?
                aSnoozed.until :
                a.get( 'receivedAt' )
        ) - (
            bSnoozed && ( !mailboxId || (
                b.isIn( 'snoozed' ) ||
                mailboxId === (
                    bSnoozed.moveToMailboxId ||
                    getInboxId( b.get( 'accountId' ) )
                )
            )) ?
                bSnoozed.until :
                b.get( 'receivedAt' )
        );
    },
    size: function ( a, b ) {
        return a.get( 'size' ) - b.get( 'size' );
    },
    from: function ( a, b ) {
        var aFrom = a.get( 'fromName' ) || a.get( 'fromEmail' );
        var bFrom = b.get( 'fromName' ) || b.get( 'fromEmail' );

        return aFrom < bFrom ? -1 : aFrom > bFrom ? 1 : 0;
    },
    to: function ( a, b ) {
        var aTo = a.get( 'to' );
        var bTo = b.get( 'to' );
        var aToPart = ( aTo && aTo.length &&
            ( aTo[0].name || aTo[0].email ) ) || '';
        var bToPart = ( bTo && bTo.length &&
            ( bTo[0].name || bTo[0].email ) ) || '';

        return aToPart < bToPart ? -1 : aTo > bToPart ? 1 : 0;
    },
    subject: function ( a, b ) {
        var aSubject = a.get( 'subject' ).replace( reOrFwd, '' );
        var bSubject = b.get( 'subject' ).replace( reOrFwd, '' );

        return aSubject < bSubject ? -1 : aSubject > bSubject ? 1 : 0;
    },
    hasKeyword: function ( a, b, field ) {
        var keyword = field.keyword;
        var aHasKeyword = !!a.get( 'keywords' )[ keyword ];
        var bHasKeyword = !!b.get( 'keywords' )[ keyword ];

        return aHasKeyword === bHasKeyword ? 0 :
            aHasKeyword ? 1 : -1;
    },
    someInThreadHaveKeyword: function ( a, b, field ) {
        var keyword = field.keyword;
        var hasKeyword = function ( message ) {
            return !!message.get( 'keywords' )[ keyword ];
        };
        var aThread = a.get( 'thread' );
        var bThread = b.get( 'thread' );
        var aMessages = aThread ? aThread.get( 'messages' ) : [ a ];
        var bMessages = bThread ? bThread.get( 'messages' ) : [ b ];
        var aHasKeyword = aMessages.some( hasKeyword );
        var bHasKeyword = bMessages.some( hasKeyword );

        return aHasKeyword === bHasKeyword ? 0 :
            aHasKeyword ? 1 : -1;
    },
};

const compareToStoreKey = function ( fields, storeKey, message ) {
    var otherMessage = storeKey && ( store.getStatus( storeKey ) & READY ) ?
            store.getRecordFromStoreKey( storeKey ) : null;
    var i, l, field, comparator, result;
    if ( !otherMessage ) {
        return 1;
    }
    for ( i = 0, l = fields.length; i < l; i += 1 ) {
        field = fields[i];
        comparator = comparators[ field.property ];
        if ( comparator &&
                ( result = comparator( otherMessage, message, field ) ) ) {
            if ( !field.isAscending ) {
                result = -result;
            }
            return result;
        }
    }
    return 0;
};

const compareToMessage = function ( fields, aData, bData ) {
    var a = aData.message;
    var b = bData.message;
    var i, l, field, comparator, result;
    for ( i = 0, l = fields.length; i < l; i += 1 ) {
        field = fields[i];
        comparator = comparators[ field.property ];
        if ( comparator && ( result = comparator( a, b, field ) ) ) {
            if ( !field.isAscending ) {
                result = -result;
            }
            return result;
        }
    }
    return 0;
};

const calculatePreemptiveAdd = function ( query, addedMessages, replaced ) {
    var storeKeys = query.getStoreKeys();
    var sort = query.get( 'sort' );
    var collapseThreads = query.get( 'collapseThreads' );
    var comparator = compareToStoreKey.bind( null, sort );
    var messageSKToIndex = {};
    var indexDelta = 0;
    var added, i, l, messageSK, threadSK, seenThreadSk, threadSKToIndex;

    added = addedMessages.reduce( function ( added, message ) {
        added.push({
            message: message,
            messageSK: message.get( 'storeKey' ),
            threadSK: collapseThreads ?
                message.getFromPath( 'thread.storeKey' ) :
                null,
            index: storeKeys.binarySearch( message, comparator ),
        });
        return added;
    }, [] );
    added.sort( compareToMessage.bind( null, sort ) );

    if ( !added.length ) {
        return added;
    }

    if ( collapseThreads ) {
        seenThreadSk = {};
        added = added.filter( function ( item ) {
            var threadSK = item.threadSK;
            if ( seenThreadSk[ threadSK ] ) {
                return false;
            }
            seenThreadSk[ threadSK ] = true;
            return true;
        });
        threadSKToIndex = {};
    }
    l = storeKeys.length;
    for ( i = 0; i < l; i += 1 ) {
        messageSK = storeKeys[i];
        if ( messageSK ) {
            if ( collapseThreads && ( store.getStatus( messageSK ) & READY ) ) {
                threadSK = store.getData( messageSK ).threadId;
                threadSKToIndex[ threadSK ] = i;
            }
            messageSKToIndex[ messageSK ] = i;
        }
    }

    return added.reduce( function ( result, item ) {
        var currentExemplarIndex = messageSKToIndex[ item.messageSK ];
        if ( item.threadSK && currentExemplarIndex === undefined ) {
            currentExemplarIndex = threadSKToIndex[ item.threadSK ];
        }
        if ( currentExemplarIndex !== undefined ) {
            if ( currentExemplarIndex >= item.index ) {
                replaced.push( storeKeys[ currentExemplarIndex ] );
            } else {
                return result;
            }
        }
        result.push({
            index: item.index + indexDelta,
            storeKey: item.messageSK,
        });
        indexDelta += 1;
        return result;
    }, [] );
};

const updateQueries = function ( filterTest, sortTest, deltas ) {
    // Set as obsolete any message list that is filtered by
    // one of the removed or added mailboxes. If it's a simple query,
    // pre-emptively update it.
    var queries = store.getAllQueries();
    var l = queries.length;
    var query, filter, sort, mailboxSK, delta, replaced, added;
    while ( l-- ) {
        query = queries[l];
        if ( query instanceof MessageList ) {
            filter = query.get( 'where' );
            sort = query.get( 'sort' );
            if ( deltas && isFilteredJustOnMailbox( filter ) ) {
                mailboxSK = store.getStoreKey(
                    query.get( 'accountId' ), Mailbox, filter.inMailbox );
                delta = deltas[ mailboxSK ];
                if ( delta ) {
                    replaced = [];
                    added =
                        calculatePreemptiveAdd( query, delta.added, replaced );
                    query.clientDidGenerateUpdate({
                        added: added,
                        removed: delta.removed,
                    });
                    if ( replaced.length ) {
                        query.clientDidGenerateUpdate({
                            added: [],
                            removed: replaced,
                        });
                    }
                }
            } else if ( filterTest( filter ) || sortTest( sort ) ) {
                query.setObsolete();
            }
        }
    }
};

// ---

const identity = function ( v ) { return v; };

const isSnoozedMailbox = function ( mailbox ) {
    return !!mailbox && mailbox.get( 'role' ) === 'snoozed';
};

const addMoveInverse = function ( inverse, undoManager, willAdd, willRemove, messageSK, wasSnoozed ) {
    var l = willRemove ? willRemove.length : 1;
    var i, addMailbox, removeMailbox, key, data;
    for ( i = 0; i < l; i += 1 ) {
        addMailbox = willAdd ? willAdd[0] : null;
        removeMailbox = willRemove ? willRemove[i] : null;
        key = ( addMailbox ? addMailbox.get( 'storeKey' ) : '-' ) +
            ( removeMailbox ? removeMailbox.get( 'storeKey' ) : '-' );
        data = inverse[ key ];
        if ( !data ) {
            data = {
                method: 'move',
                messageSKs: [],
                args: [ null, removeMailbox, addMailbox, true, {} ],
            };
            inverse[ key ] = data;
            undoManager.pushUndoData( data );
        }
        data.messageSKs.push( messageSK );
        if ( wasSnoozed ) {
            data.args[4][ messageSK ] = wasSnoozed;
        }
        willAdd = null;
    }
};

// Sets snooze details and returns old details if set and different to new.
// snooze can be a SnoozeDetails object or a map of store key -> SnoozeDetails.
const setSnoozed = function ( message, newSnoozed ) {
    var oldSnoozed = message.get( 'snoozed' );
    if ( !isEqual( oldSnoozed, newSnoozed ) ) {
        message.set( 'snoozed', newSnoozed );
        return oldSnoozed;
    }
    return null;
};

const isSnoozeRemoved = function ( willRemove, snoozed ) {
    if ( !snoozed || !willRemove ) {
        return false;
    }
    var moveToMailboxId = snoozed.moveToMailboxId;
    return willRemove.some( moveToMailboxId ?
        ( mailbox => (
            mailbox.get( 'role' ) === 'snoozed' ||
            mailbox.get( 'id' ) === moveToMailboxId ) ) :
        ( mailbox => (
            mailbox.get( 'role' ) === 'snoozed' ||
            mailbox.get( 'role' ) === 'inbox' ) )
    );
};

// ---

const NO = 0;
const TO_MAILBOX = 1;
const TO_THREAD_IN_NOT_TRASH = 2;
const TO_THREAD_IN_TRASH = 4;
const TO_THREAD = (TO_THREAD_IN_NOT_TRASH|TO_THREAD_IN_TRASH);

const getMessages = function getMessages ( messageSKs, expand, mailbox, callback, hasDoneLoad ) {
    // Map to threads, then make sure all threads, including headers
    // are loaded
    var allLoaded = true;
    var messages = [];

    var checkMessage = function ( message ) {
        if ( message.is( READY ) ) {
            if ( expand === TO_MAILBOX && mailbox ) {
                if ( message.get( 'mailboxes' ).contains( mailbox ) ) {
                    messages.push( message );
                }
            } else if ( expand & TO_THREAD ) {
                if ( (( expand & TO_THREAD_IN_NOT_TRASH ) &&
                        message.get( 'isInNotTrash' )) ||
                     (( expand & TO_THREAD_IN_TRASH ) &&
                        message.get( 'isInTrash' )) ) {
                    messages.push( message );
                }
            } else {
                messages.push( message );
            }
        } else {
            allLoaded = false;
        }
    };

    messageSKs.forEach( function ( messageSK ) {
        var thread, message;
        if ( expand ) {
            if ( store.getStatus( messageSK ) & READY ) {
                thread = store.getRecordFromStoreKey( messageSK )
                              .get( 'thread' );
                if ( thread && thread.is( READY ) ) {
                    thread.get( 'messages' ).forEach( checkMessage );
                } else {
                    allLoaded = false;
                }
            } else {
                // Fetch all messages in thread
                connection.fetchRecord(
                    store.getAccountIdFromStoreKey( messageSK ),
                    Message.Thread,
                    store.getIdFromStoreKey( messageSK ) );
                allLoaded = false;
            }
        } else {
            message = store.getRecordFromStoreKey( messageSK );
            checkMessage( message );
        }
    });

    if ( allLoaded || hasDoneLoad ) {
        connection.gc.isPaused = false;
        callback( messages );
    } else {
        // Suspend gc and wait for next API request: guaranteed to load
        // everything
        connection.gc.isPaused = true;
        connection.addCallback(
            getMessages.bind( null,
                messageSKs, expand, mailbox, callback, true )
        );
    }
    return true;
};

// ---

const doUndoAction = function ( method, args ) {
    return function ( callback, messages ) {
        if ( messages ) {
            args[0] = messages;
        }
        connection[ method ].apply( connection, args );
        callback( null );
    };
};

// ---

const roleIndex = new O.Object({
    index: null,
    clearIndex: function () {
        this.index = null;
    },
    buildIndex: function () {
        var index = this.index = store.getAll( Mailbox ).reduce(
            function ( index, mailbox ) {
                var accountId = mailbox.get( 'accountId' );
                var role = mailbox.get( 'role' );
                if ( role ) {
                    ( index[ accountId ] ||
                        ( index[ accountId ] = {} ) )[ role ] = mailbox;
                }
                return index;
            }, {} );
        return index;
    },
    getIndex: function () {
        return this.index || this.buildIndex();
    },
});
store.on( Mailbox, roleIndex, 'clearIndex' );

const getMailboxForRole = function ( accountId, role, createWithProps ) {
    if ( !accountId ) {
        accountId = auth.get( 'primaryAccounts' )[ auth.MAIL_DATA ];
    }
    var accountIndex = roleIndex.getIndex()[ accountId ];
    var mailbox = accountIndex && accountIndex[ role ] || null;
    if ( !mailbox && createWithProps ) {
        // The other role names are not localised over IMAP, so I guess
        // we don't with this one either?
        var name = role.capitalise();
        var nameClashes = store.getAll( Mailbox, data =>
            data.accountId === accountId &&
            !data.parentId &&
            data.name.startsWith( name )
        ).reduce( ( nameClashes, mailbox ) => {
            var name = mailbox.get( 'name' );
            nameClashes[ name ] = mailbox;
            return nameClashes;
        }, {} );
        var index, property;
        mailbox = nameClashes[ name ];
        if ( mailbox ) {
            index = 2;
            while ( nameClashes[ name + ' ' + index ] ) {
                index += 1;
            }
            mailbox.set( 'name', name + ' ' + index );
        }
        mailbox = new Mailbox( store )
            .set( 'role', role )
            .set( 'name', name );
        for ( property in createWithProps ) {
            mailbox.set( property, createWithProps[ property ] );
        }
        mailbox.saveToStore();
    }
    return mailbox;
};

// ---

const logACLsError = function ( type, mailbox ) {
    var name = mailbox.get( 'name' );
    O.RunLoop.didError({
        name: 'JMAP.mail.move',
        message: 'May not ' + type + ' messages in ' + name,
        details: {
            status: mailbox.get( 'status' ),
            myRights: mailbox.get( 'myRights' ),
        },
    });
};

Object.assign( connection, {

    NO: NO,
    TO_MAILBOX: TO_MAILBOX,
    TO_THREAD_IN_NOT_TRASH: TO_THREAD_IN_NOT_TRASH,
    TO_THREAD_IN_TRASH: TO_THREAD_IN_TRASH,
    TO_THREAD: TO_THREAD,

    getMessages: getMessages,

    getMailboxForRole: getMailboxForRole,

    // ---

    findMessage: function ( accountId, where ) {
        return new Promise( function ( resolve, reject ) {
            connection.callMethod( 'Email/query', {
                accountId: accountId,
                filter: where,
                sort: null,
                position: 0,
                limit: 1,
            }, function ( responseArgs, responseName ) {
                var id;
                if ( responseName === 'Email/query' ) {
                    id = responseArgs.ids[0];
                    if ( id ) {
                        resolve( store.getRecord( accountId, Message, id ) );
                    } else {
                        reject({
                            type: 'notFound',
                        });
                    }
                } else {
                    reject( responseArgs );
                }
            }).callMethod( 'Email/get', {
                accountId: accountId,
                '#ids': {
                    resultOf: connection.getPreviousMethodId(),
                    name: 'Email/query',
                    path: '/ids',
                },
                properties: Message.headerProperties,
            });
        });
    },

    // ---

    gc: new O.MemoryManager( store, [
        {
            Type: Message,
            max: 1200
        },
        {
            Type: Thread,
            max: 1000
        },
        {
            Type: MessageList,
            max: 5,
            // This is really needed to check for disappearing Messages/Threads,
            // but more efficient to run it here.
            afterCleanup: function () {
                var queries = store.getAllQueries();
                var l = queries.length;
                var query;
                while ( l-- ) {
                    query = queries[l];
                    if ( query instanceof MessageList ) {
                        query.recalculateFetchedWindows();
                    }
                }
            }
        }
    ], 60000 ),

    undoManager: new O.UndoManager({

        store: store,

        maxUndoCount: 10,

        pending: [],
        sequence: null,

        getUndoData: function () {
            var data = this.pending;
            if ( data.length ) {
                this.pending = [];
            } else {
                data = null;
            }
            return data;
        },

        pushUndoData: function ( data ) {
            this.pending.push( data );
            if ( !this.get( 'sequence' ) ) {
                this.dataDidChange();
            }
            return data;
        },

        applyChange: function ( data ) {
            var pending = this.pending;
            var sequence = new JMAP.Sequence();
            var l = data.length;
            var call, messageSKs;

            while ( l-- ) {
                call = data[l];
                messageSKs = call.messageSKs;
                if ( messageSKs ) {
                    sequence.then(
                        getMessages.bind( null, messageSKs, NO, null ) );
                }
                sequence.then( doUndoAction( call.method, call.args ) );
            }

            sequence.afterwards = function () {
                this.set( 'sequence', null );
                if ( !pending.length ) {
                    var redoStack = this._redoStack;
                    if ( redoStack.last() === pending ) {
                        redoStack.pop();
                        this.set( 'canRedo', !!redoStack.length );
                    }
                    // This could get called synchronously before applyChange
                    // returns depending on the undoAction; set pending to null
                    // to ensure we don't add a noop to the redo stack.
                    pending = null;
                }
                this.pending = [];
            }.bind( this );

            this.set( 'sequence', sequence );

            sequence.go( null );

            return pending;
        }
    }),

    // ---

    setUnread: function ( messages, isUnread, allowUndo ) {
        var mailboxDeltas = {};
        var inverseMessageSKs = allowUndo ? [] : null;
        var inverse = allowUndo ? {
                method: 'setUnread',
                messageSKs: inverseMessageSKs,
                args: [
                    null,
                    !isUnread,
                    true
                ]
            } : null;

        messages.forEach( function ( message ) {
            // Check we have something to do
            if ( message.get( 'isUnread' ) === isUnread ||
                    !message.hasPermission( 'maySetSeen' ) ) {
                return;
            }

            // Get the thread and cache the current unread state
            var thread = message.getThreadIfReady();
            var isInTrash = message.get( 'isInTrash' );
            var isInNotTrash = message.get( 'isInNotTrash' );
            var threadUnreadInTrash =
                isInTrash && thread && thread.get( 'isUnreadInTrash' ) ?
                1 : 0;
            var threadUnreadInNotTrash =
                isInNotTrash && thread && thread.get( 'isUnreadInNotTrash' ) ?
                1 : 0;
            var mailboxCounts, mailboxSK, mailbox, delta, unreadDelta;

            // Update the message
            message.set( 'isUnread', isUnread );

            // Add inverse for undo
            if ( allowUndo ) {
                inverseMessageSKs.push( message.get( 'storeKey' ) );
            }

            // Draft messages unread status don't count in mailbox unread counts
            if ( message.get( 'isDraft' ) ) {
                return;
            }

            // Calculate any changes to the mailbox unread message counts
            message.get( 'mailboxes' ).forEach( function ( mailbox ) {
                var mailboxSK = mailbox.get( 'storeKey' );
                var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                delta.unreadEmails += isUnread ? 1 : -1;
            });

            // See if the thread unread state has changed
            if ( isInTrash && thread ) {
                threadUnreadInTrash =
                    Number( thread.get( 'isUnreadInTrash' ) ) -
                        threadUnreadInTrash;
            }
            if ( isInNotTrash && thread ) {
                threadUnreadInNotTrash =
                    Number( thread.get( 'isUnreadInNotTrash' ) ) -
                        threadUnreadInNotTrash;
            }

            // Calculate any changes to the mailbox unread thread counts
            if ( threadUnreadInNotTrash || threadUnreadInTrash ) {
                mailboxCounts = thread.get( 'mailboxCounts' );
                for ( mailboxSK in mailboxCounts ) {
                    mailbox = store.getRecordFromStoreKey( mailboxSK );
                    unreadDelta = mailbox.get( 'role' ) === 'trash' ?
                        threadUnreadInTrash : threadUnreadInNotTrash;
                    if ( unreadDelta ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                        delta.unreadThreads += unreadDelta;
                    }
                }
            }
        });

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( isFilteredOnUnread, isSortedOnUnread, null );

        if ( allowUndo && inverseMessageSKs.length ) {
            this.undoManager.pushUndoData( inverse );
        }

        return this;
    },

    setKeyword: function ( messages, keyword, value, allowUndo ) {
        var inverseMessageSKs = allowUndo ? [] : null;
        var inverse = allowUndo ? {
                method: 'setKeyword',
                messageSKs: inverseMessageSKs,
                args: [
                    null,
                    keyword,
                    !value,
                    true
                ]
            } : null;

        messages.forEach( function ( message ) {
            // Check we have something to do
            if ( !!message.get( 'keywords' )[ keyword ] === value ||
                    !message.hasPermission( 'maySetKeywords' ) ) {
                return;
            }

            // Update the message
            message.setKeyword( keyword, value );

            // Add inverse for undo
            if ( allowUndo ) {
                inverseMessageSKs.push( message.get( 'storeKey' ) );
            }
        });

        // Update message list queries, or mark in need of refresh
        updateQueries(
            isFilteredOnKeyword.bind( null, keyword ),
            isSortedOnKeyword.bind( null, keyword ),
            null
        );

        if ( allowUndo && inverseMessageSKs.length ) {
            this.undoManager.pushUndoData( inverse );
        }

        return this;
    },

    move: function ( messages, addMailbox, removeMailbox, allowUndo, snoozed ) {
        var mailboxDeltas = {};
        var inverse = allowUndo ? {} : null;
        var removeAll = removeMailbox === 'ALL';
        var undoManager = this.undoManager;
        var addMailboxOnlyIfNone = false;
        var isAddingToSnoozed = isSnoozedMailbox( addMailbox );
        var toCopy = {};
        var now = new Date().toJSON() + 'Z';
        var accountId, fromAccountId, mailboxIds;

        if ( !addMailbox ) {
            addMailboxOnlyIfNone = true;
            accountId = messages.length ?
                messages[0].get( 'accountId' ) : null;
            addMailbox =
                getMailboxForRole( accountId, 'archive' ) ||
                getMailboxForRole( accountId, 'inbox' );
        } else {
            accountId = addMailbox.get( 'accountId' );
        }
        if ( removeAll ) {
            removeMailbox = null;
        }

        // Check we're not moving from/to the same place
        if ( addMailbox === removeMailbox && !addMailboxOnlyIfNone ) {
            return this;
        }

        // Check ACLs
        if ( addMailbox && ( !addMailbox.is( READY ) ||
                !addMailbox.get( 'myRights' ).mayAddItems ) ) {
            logACLsError( 'add', addMailbox );
            return this;
        }
        if ( removeMailbox && ( !removeMailbox.is( READY ) ||
                !removeMailbox.get( 'myRights' ).mayRemoveItems ) ) {
            logACLsError( 'remove', removeMailbox );
            return this;
        }

        // Can't move to snoozed mailbox without snooze details
        if ( isAddingToSnoozed && !snoozed ) {
            return this;
        }

        messages.forEach( function ( message ) {
            var messageSK = message.get( 'storeKey' );
            var mailboxes = message.get( 'mailboxes' );
            var messageAccountId = message.get( 'accountId' );

            // Calculate the set of mailboxes to add/remove
            var willAdd = addMailbox && [ addMailbox ];
            var willRemove = null;
            var mailboxToRemoveIndex = -1;
            var alreadyHasMailbox = false;

            var wasThreadUnreadInNotTrash = false;
            var wasThreadUnreadInTrash = false;
            var isThreadUnreadInNotTrash = false;
            var isThreadUnreadInTrash = false;
            var mailboxCounts = null;

            var wasSnoozed = null;
            var newSnoozed = snoozed && !( snoozed instanceof SnoozeDetails ) ?
                snoozed[ message.get( 'storeKey' ) ] || null :
                snoozed || null;

            var isUnread, thread;
            var deltaThreadUnreadInNotTrash, deltaThreadUnreadInTrash;
            var decrementMailboxCount, incrementMailboxCount;
            var delta, mailboxSK, mailbox, removedDates;

            // Calculate the changes required to the message's mailboxes
            if ( removeAll ) {
                willRemove = mailboxes.map( identity );
                mailboxToRemoveIndex = 0;
                alreadyHasMailbox = mailboxes.contains( addMailbox );
                if ( alreadyHasMailbox && willRemove.length === 1 ) {
                    willRemove = willAdd = null;
                }
            } else {
                mailboxes.forEach( function ( mailbox, index ) {
                    if ( mailbox === addMailbox ) {
                        willAdd = null;
                    }
                    if ( mailbox === removeMailbox ) {
                        willRemove = [ mailbox ];
                        mailboxToRemoveIndex = index;
                    }
                });
            }

            // Check we have something to do
            if ( !willRemove && ( !willAdd || addMailboxOnlyIfNone ) ) {
                // We may be updating snooze but not moving
                if ( isAddingToSnoozed && newSnoozed ) {
                    wasSnoozed = setSnoozed( message, newSnoozed );
                    if ( allowUndo && wasSnoozed ) {
                        addMoveInverse(
                            inverse,
                            undoManager,
                            addMailbox,
                            null,
                            messageSK,
                            wasSnoozed
                        );
                    }
                }
                return;
            }

            if ( addMailboxOnlyIfNone ) {
                if ( willRemove.length !== mailboxes.get( 'length' ) ) {
                    willAdd = null;
                } else if ( !willAdd ) {
                    // Can't remove from everything without adding
                    return;
                }
            }

            // Get the thread and cache the current unread state
            isUnread = message.get( 'isUnread' ) && !message.get( 'isDraft' );
            thread = message.getThreadIfReady();
            if ( thread ) {
                wasThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
            }

            // Handle moving cross-account
            if ( willAdd && messageAccountId !== accountId ) {
                if ( removeAll ||
                        ( willRemove && mailboxes.get( 'length' ) === 1 ) ) {
                    // Removing all existing mailboxes.
                    // Preemptively remove it from the thread
                    if ( thread ) {
                        thread.get( 'messages' ).remove( message );
                        thread.fetch();
                    }
                    // And move to new account id.
                    message = message.set( 'accountId', accountId );
                } else {
                    // Otherwise, we need to copy.
                    ( toCopy[ messageAccountId ] ||
                        ( toCopy[ messageAccountId ] = [] ) ).push( message );
                    if ( willRemove ) {
                        willAdd = null;
                    } else {
                        return;
                    }
                }
            }

            // Update the message
            mailboxes.replaceObjectsAt(
                willRemove ? mailboxToRemoveIndex : mailboxes.get( 'length' ),
                willRemove ? willRemove.length : 0,
                willAdd
            );
            if ( willRemove ) {
                removedDates = clone( message.get( 'removedDates' ) ) || {};
                willRemove.forEach( mailbox => {
                    removedDates[ mailbox.get( 'id' ) ] = now;
                });
                message.set( 'removedDates', removedDates );
            }

            if ( alreadyHasMailbox ) {
                willAdd = null;
                willRemove.erase( addMailbox );
            }

            // Set snoozed if given; clear snooze if removing from
            // mailbox target of snooze and not still in Snoozed mailbox.
            if ( newSnoozed ) {
                wasSnoozed = setSnoozed( message, newSnoozed );
            } else if ( !message.isIn( 'snoozed' ) &&
                    isSnoozeRemoved( willRemove, message.get( 'snoozed' ) ) ) {
                wasSnoozed = setSnoozed( message, null );
            }

            // Add inverse for undo
            if ( allowUndo ) {
                addMoveInverse( inverse, undoManager,
                    // Don't use messageSK, because we need the new store key
                    // if we moved it to a new account
                    willAdd, willRemove, message.get( 'storeKey' ),
                    wasSnoozed );
            }

            // Calculate any changes to the mailbox message counts
            if ( thread ) {
                isThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
                mailboxCounts = thread.get( 'mailboxCounts' );
            }

            decrementMailboxCount = function ( mailbox ) {
                var mailboxSK = mailbox.get( 'storeKey' );
                var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                delta.removed.push( messageSK );
                delta.totalEmails -= 1;
                if ( isUnread ) {
                    delta.unreadEmails -= 1;
                }
                // If this was the last message in the thread in the mailbox
                if ( thread && !mailboxCounts[ mailboxSK ] ) {
                    delta.totalThreads -= 1;
                    if ( mailbox.get( 'role' ) === 'trash' ?
                            wasThreadUnreadInTrash :
                            wasThreadUnreadInNotTrash ) {
                        delta.unreadThreads -= 1;
                    }
                }
            };
            incrementMailboxCount = function ( mailbox ) {
                var mailboxSK = mailbox.get( 'storeKey' );
                var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                // Don't pre-emptively add to any queries when moving
                // cross-account. The thread reference will change, but this is
                // an immutable property so you don't want a view to render
                // thinking the message is READY and then have it change.
                if ( messageAccountId === accountId ) {
                    delta.added.push( message );
                }
                delta.totalEmails += 1;
                if ( isUnread ) {
                    delta.unreadEmails += 1;
                }
                // If this was the first message in the thread in the
                // mailbox
                if ( thread && mailboxCounts[ mailboxSK ] === 1 ) {
                    delta.totalThreads += 1;
                    if ( mailbox.get( 'role' ) === 'trash' ?
                            isThreadUnreadInTrash : isThreadUnreadInNotTrash ) {
                        delta.unreadThreads += 1;
                    }
                }
            };

            if ( willRemove ) {
                willRemove.forEach( decrementMailboxCount );
            }
            if ( willAdd ) {
                willAdd.forEach( incrementMailboxCount );
            }

            // If the thread unread state has changed (due to moving in/out of
            // trash), we might need to update mailboxes that the messages is
            // not in now and wasn't in before!
            // We need to adjust the count for any mailbox that hasn't already
            // been updated above. This means it must either:
            // 1. Have more than 1 message in the thread in it; or
            // 2. Not have been in the set of mailboxes we just added to this
            //    message
            deltaThreadUnreadInNotTrash =
                ( isThreadUnreadInNotTrash ? 1 : 0 ) -
                ( wasThreadUnreadInNotTrash ? 1 : 0 );
            deltaThreadUnreadInTrash =
                ( isThreadUnreadInTrash ? 1 : 0 ) -
                ( wasThreadUnreadInTrash ? 1 : 0 );

            if ( deltaThreadUnreadInNotTrash || deltaThreadUnreadInTrash ) {
                for ( mailboxSK in mailboxCounts ) {
                    mailbox = store.getRecordFromStoreKey( mailboxSK );
                    if ( mailboxCounts[ mailboxSK ] > 1 ||
                            !willAdd.contains( mailbox ) ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                        if ( mailbox.get( 'role' ) === 'trash' ) {
                            delta.unreadThreads += deltaThreadUnreadInTrash;
                        } else {
                            delta.unreadThreads += deltaThreadUnreadInNotTrash;
                        }
                    }
                }
            }
        });

        // Copy if necessary
        for ( fromAccountId in toCopy ) {
            mailboxIds = {};
            mailboxIds[ addMailbox.toIdOrStoreKey() ] = true;
            this.callMethod( 'Email/copy', {
                fromAccountId: fromAccountId,
                accountId: accountId,
                create: toCopy[ fromAccountId ].reduce(
                    function ( map, message, index ) {
                        map[ 'copy' + index ] = {
                            id: message.get( 'id' ),
                            mailboxIds: mailboxIds,
                            keywords: message.get( 'keywords' ),
                        };
                        return map;
                    }, {} ),
            });
        }
        if ( Object.keys( toCopy ).length ) {
            // If we copied something, we need to fetch the changes manually
            // as we don't track this ourselves.
            store
                .fetchAll( accountId, Mailbox, true )
                .fetchAll( accountId, Thread, true )
                .fetchAll( accountId, Message, true );
        }

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( isFilteredOnMailboxes, returnFalse, mailboxDeltas );

        return this;
    },

    destroy: function ( messages ) {
        var mailboxDeltas = {};

        messages.forEach( function ( message ) {
            var messageSK = message.get( 'storeKey' );
            var mailboxes = message.get( 'mailboxes' );

            var wasThreadUnreadInNotTrash = false;
            var wasThreadUnreadInTrash = false;
            var isThreadUnreadInNotTrash = false;
            var isThreadUnreadInTrash = false;
            var mailboxCounts = null;

            var isUnread, thread;
            var deltaThreadUnreadInNotTrash, deltaThreadUnreadInTrash;
            var delta, mailboxSK, mailbox, messageWasInMailbox, isTrash;

            // Get the thread and cache the current unread state
            isUnread = message.get( 'isUnread' ) && !message.get( 'isDraft' );
            thread = message.getThreadIfReady();
            if ( thread ) {
                mailboxCounts = thread.get( 'mailboxCounts' );
                wasThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
            }

            // Update the message
            message.destroy();

            if ( thread ) {
                // Preemptively update the thread
                thread.get( 'messages' ).remove( message );
                thread.fetch();

                // Calculate any changes to the mailbox message counts
                isThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );

                deltaThreadUnreadInNotTrash =
                    ( isThreadUnreadInNotTrash ? 1 : 0 ) -
                    ( wasThreadUnreadInNotTrash ? 1 : 0 );
                deltaThreadUnreadInTrash =
                    ( isThreadUnreadInTrash ? 1 : 0 ) -
                    ( wasThreadUnreadInTrash ? 1 : 0 );

                for ( mailboxSK in mailboxCounts ) {
                    mailbox = store.getRecordFromStoreKey( mailboxSK );
                    messageWasInMailbox = mailboxes.contains( mailbox );
                    isTrash = mailbox.get( 'role' ) === 'trash';
                    if ( messageWasInMailbox ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxSK );
                        delta.totalEmails -= 1;
                        if ( isUnread ) {
                            delta.unreadEmails -= 1;
                        }
                        delta.removed.push( messageSK );
                        if ( mailboxCounts[ mailboxSK ] === 1 ) {
                            delta.totalThreads -= 1;
                        }
                    }
                    if ( isTrash && deltaThreadUnreadInTrash ) {
                        getMailboxDelta( mailboxDeltas, mailboxSK )
                            .unreadThreads += deltaThreadUnreadInTrash;
                    } else if ( !isTrash && deltaThreadUnreadInNotTrash ) {
                        getMailboxDelta( mailboxDeltas, mailboxSK )
                            .unreadThreads += deltaThreadUnreadInNotTrash;
                    }
                }
            } else {
                mailboxes.forEach( function ( mailbox ) {
                    var delta = getMailboxDelta(
                        mailboxDeltas, mailbox.get( 'storeKey' ) );
                    delta.totalEmails -= 1;
                    if ( isUnread ) {
                        delta.unreadEmails -= 1;
                    }
                    delta.removed.push( messageSK );
                });
            }
        });

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( returnTrue, returnFalse, mailboxDeltas );

        return this;
    },

    report: function ( messages, asSpam, allowUndo ) {
        var messageSKs = [];
        var accounts = {};
        var accountId;

        messages.forEach( function ( message ) {
            var accountId = message.get( 'accountId' );
            var account = accounts[ accountId ] ||
                ( accounts[ accountId ] = [] );
            account.push( message.get( 'id' ) );
            messageSKs.push( message.get( 'storeKey' ) );
        });

        for ( accountId in accounts ) {
            this.callMethod( 'Email/report', {
                accountId: accountId,
                ids: accounts[ accountId ],
                type: asSpam ? 'spam' : 'notspam',
            });
        }

        if ( allowUndo ) {
            this.undoManager.pushUndoData({
                method: 'report',
                messageSKs: messageSKs,
                args: [
                    null,
                    !asSpam,
                    true
                ],
            });
        }

        return this;
    },

    // ---

    create: function ( message ) {
        var thread = message.getThreadIfReady();
        var mailboxes = message.get( 'mailboxes' );
        var wasThreadUnreadInNotTrash = false;
        var wasThreadUnreadInTrash = false;
        var isThreadUnreadInNotTrash = false;
        var isThreadUnreadInTrash = false;
        var deltaThreadUnreadInTrash = false;
        var deltaThreadUnreadInNotTrash = false;
        var isDraft = message.get( 'isDraft' );
        var isUnread = !isDraft && message.get( 'isUnread' );
        var mailboxDeltas = {};
        var mailboxCounts = null;
        var mailboxSK, mailbox, isTrash;

        // Cache the current thread state
        if ( thread ) {
            mailboxCounts = thread.get( 'mailboxCounts' );
            wasThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
            wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
        }

        // If not in any mailboxes, make it a draft
        if ( mailboxes.get( 'length' ) === 0 ) {
            message
                .set( 'isDraft', true )
                .set( 'isUnread', false );
            mailboxes.add(
                getMailboxForRole( message.get( 'accountId' ), 'drafts' ) ||
                getMailboxForRole( null, 'drafts' )
            );
        }

        // Create the message
        message.saveToStore();

        if ( mailboxCounts ) {
            // Preemptively update the thread
            var messages = thread.get( 'messages' );
            var l = messages.get( 'length' );
            var receivedAt = message.get( 'receivedAt' );
            while ( l-- ) {
                if ( receivedAt >=
                        messages.getObjectAt( l ).get( 'receivedAt' ) ) {
                    break;
                }
            }
            messages.replaceObjectsAt( l + 1, 0, [ message ] );
            thread.fetch();

            // Calculate any changes to the mailbox message counts
            isThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
            isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );

            deltaThreadUnreadInNotTrash =
                ( isThreadUnreadInNotTrash ? 1 : 0 ) -
                ( wasThreadUnreadInNotTrash ? 1 : 0 );
            deltaThreadUnreadInTrash =
                ( isThreadUnreadInTrash ? 1 : 0 ) -
                ( wasThreadUnreadInTrash ? 1 : 0 );
        }

        mailboxes.forEach( function ( mailbox ) {
            var mailboxSK = mailbox.get( 'storeKey' );
            var delta = getMailboxDelta( mailboxDeltas, mailboxSK );
            delta.added.push( message );
            delta.totalEmails += 1;
            if ( isUnread ) {
                delta.unreadEmails += 1;
            }
            if ( mailboxCounts && !mailboxCounts[ mailboxSK ] ) {
                delta.totalThreads += 1;
                if ( mailbox.get( 'role' ) === 'trash' ?
                        isThreadUnreadInTrash : isThreadUnreadInNotTrash ) {
                    delta.unreadThreads += 1;
                }
            }
        });

        for ( mailboxSK in mailboxCounts ) {
            mailbox = store.getRecordFromStoreKey( mailboxSK );
            isTrash = mailbox.get( 'role' ) === 'trash';
            if ( !mailboxes.contains( mailbox ) ) {
                if ( isTrash && deltaThreadUnreadInTrash ) {
                    getMailboxDelta( mailboxDeltas, mailboxSK )
                        .unreadThreads += deltaThreadUnreadInTrash;
                } else if ( !isTrash && deltaThreadUnreadInNotTrash ) {
                    getMailboxDelta( mailboxDeltas, mailboxSK )
                        .unreadThreads += deltaThreadUnreadInNotTrash;
                }
            }
        }

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( returnTrue, returnFalse, mailboxDeltas );

        return this;
    },

    // ---

    redirect: function ( messages, to ) {
        var envelope = {
            mailFrom: {
                email: auth.get( 'username' ),
                parameters: {
                    resent: null,
                },
            },
            rcptTo: to.map( function ( address ) {
                return {
                    email: address.email,
                    parameters: null,
                };
            }),
        };

        return messages.map( function ( message ) {
            return new MessageSubmission( store )
                .set( 'accountId', message.get( 'accountId' ) )
                .set( 'identity', null )
                .set( 'message', message )
                .set( 'envelope', envelope )
                .saveToStore();
        });
    },
});

}( JMAP ) );
