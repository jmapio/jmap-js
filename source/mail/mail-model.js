// -------------------------------------------------------------------------- \\
// File: mail-model.js                                                        \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js, Thread.js, Message.js, MessageList.js           \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

var store = JMAP.store;
var Mailbox = JMAP.Mailbox;
var Thread = JMAP.Thread;
var Message = JMAP.Message;
var MessageList = JMAP.MessageList;

// --- Preemptive mailbox count updates ---

var getMailboxDelta = function ( deltas, mailboxId ) {
    return deltas[ mailboxId ] || ( deltas[ mailboxId ] = {
        totalMessages: 0,
        unreadMessages: 0,
        totalThreads: 0,
        unreadThreads: 0,
        removed: [],
        added: []
    });
};

var updateMailboxCounts = function ( mailboxDeltas ) {
    var mailboxId, delta, mailbox;
    for ( mailboxId in mailboxDeltas ) {
        delta = mailboxDeltas[ mailboxId ];
        mailbox = store.getRecord( Mailbox, mailboxId );
        if ( delta.totalMessages ) {
            mailbox.increment( 'totalMessages', delta.totalMessages );
        }
        if ( delta.unreadMessages ) {
            mailbox.increment( 'unreadMessages', delta.unreadMessages );
        }
        if ( delta.totalThreads ) {
            mailbox.increment( 'totalThreads', delta.totalThreads );
        }
        if ( delta.unreadThreads ) {
            mailbox.increment( 'unreadThreads', delta.unreadThreads );
        }
        // Fetch the real counts, just in case. We set it obsolete
        // first, so if another fetch is already in progress, the
        // results of that are discarded and it is fetched again.
        mailbox.setObsolete()
               .refresh();
    }
};

// --- Preemptive query updates ---

var filterHasKeyword = function ( filter, keyword ) {
    return (
        keyword === filter.allInThreadHaveKeyword ||
        keyword === filter.someInThreadHaveKeyword ||
        keyword === filter.noneInThreadHaveKeyword ||
        keyword === filter.hasKeyword ||
        keyword === filter.notKeyword
    );
};

var isSortedOnUnread = function ( sort ) {
    for ( var i = 0, l = sort.length; i < l; i += 1 ) {
        if ( /:$Seen /.test( sort[i] ) ) {
            return true;
        }
    }
    return false;
};
var isFilteredOnUnread = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnUnread );
    }
    return filterHasKeyword( filter, '$Seen' );
};
var isSortedOnFlagged = function ( sort ) {
    for ( var i = 0, l = sort.length; i < l; i += 1 ) {
        if ( /:$Flagged /.test( sort[i] ) ) {
            return true;
        }
    }
    return false;
};
var isFilteredOnFlagged = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnFlagged );
    }
    return filterHasKeyword( filter, '$Flagged' );
};
var isFilteredOnMailboxes = function ( filter ) {
    if ( filter.operator ) {
        return filter.conditions.some( isFilteredOnMailboxes );
    }
    return ( 'inMailbox' in filter ) || ( 'inMailboxOtherThan' in filter );
};
var isFilteredJustOnMailbox = function ( filter ) {
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
var isTrue = function () {
    return true;
};
var isFalse = function () {
    return false;
};

// ---

var READY = O.Status.READY;

var reOrFwd = /^(?:(?:re|fwd):\s*)+/;
var comparators = {
    id: function ( a, b ) {
        var aId = a.get( 'id' );
        var bId = b.get( 'id' );

        return aId < bId ? -1 : aId > bId ? 1 : 0;
    },
    date: function ( a, b ) {
        return a.get( 'date' ) - b.get( 'date' );
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
        var aToPart = aTo && aTo.length ? aTo[0].name || aTo[0].email : '';
        var bToPart = bTo && bTo.length ? bTo[0].name || bTo[0].email : '';

        return aToPart < bToPart ? -1 : aTo > bToPart ? 1 : 0;
    },
    subject: function ( a, b ) {
        var aSubject = a.get( 'subject' ).replace( reOrFwd, '' );
        var bSubject = b.get( 'subject' ).replace( reOrFwd, '' );

        return aSubject < bSubject ? -1 : aSubject > bSubject ? 1 : 0;
    },
    'keyword:$Flagged': function ( a, b ) {
        var aFlagged = a.get( 'isFlagged' );
        var bFlagged = b.get( 'isFlagged' );

        return aFlagged === bFlagged ? 0 :
            aFlagged ? -1 : 1;
    },
    'someThreadKeyword:$Flagged': function ( a, b ) {
        return comparators.isFlagged( a.get( 'thread' ), b.get( 'thread' ) );
    }
};

var compareToStoreKey = function ( fields, storeKey, message ) {
    var otherMessage = storeKey && ( store.getStatus( storeKey ) & READY ) ?
            store.getRecord( Message, '#' + storeKey ) : null;
    var i, l, comparator, result;
    if ( !otherMessage ) {
        return 1;
    }
    for ( i = 0, l = fields.length; i < l; i += 1 ) {
        comparator = comparators[ fields[i][0] ];
        if ( comparator && ( result = comparator( otherMessage, message ) ) ) {
            return result * fields[i][1];
        }
    }
    return 0;
};

var compareToMessage = function ( fields, aData, bData ) {
    var a = aData.message;
    var b = bData.message;
    var i, l, comparator, result;
    for ( i = 0, l = fields.length; i < l; i += 1 ) {
        comparator = comparators[ fields[i] ];
        if ( comparator && ( result = comparator( a, b ) ) ) {
            return result;
        }
    }
    return 0;
};

var splitDirection = function ( field ) {
    var space = field.indexOf( ' ' );
    var prop = space ? field.slice( 0, space ) : field;
    var dir = space && field.slice( space + 1 ) === 'asc' ? 1 : -1;
    return [ prop, dir ];
};

var calculatePreemptiveAdd = function ( query, addedMessages ) {
    var storeKeyList = query._list;
    var sort = query.get( 'sort' ).map( splitDirection );
    var comparator = compareToStoreKey.bind( null, sort );
    var added = addedMessages.reduce( function ( added, message ) {
            added.push({
                message: message,
                messageSK: message.get( 'storeKey' ),
                threadSK: message.get( 'thread' ).get( 'storeKey' ),
                index: storeKeyList.binarySearch( message, comparator )
            });
            return added;
        }, [] );

    var collapseThreads = query.get( 'collapseThreads' );
    var messageToThreadSK = query.get( 'messageToThreadSK' );
    var threadToMessageSK = collapseThreads && added.length ?
            storeKeyList.reduce( function ( map, messageSK ) {
                if ( messageSK ) {
                    map[ messageToThreadSK[ messageSK ] ] = messageSK;
                }
                return map;
            }, {} ) :
            {};

    added.sort( compareToMessage.bind( null, sort ) );

    return added.length ? added.reduce( function ( result, item ) {
        var messageSK = item.messageSK;
        var threadSK = item.threadSK;
        if ( !collapseThreads || !threadToMessageSK[ threadSK ] ) {
            threadToMessageSK[ threadSK ] = messageSK;
            messageToThreadSK[ messageSK ] = threadSK;
            result.push([ item.index + result.length, messageSK ]);
        }
        return result;
    }, [] ) : null;
};

var updateQueries = function ( filterTest, sortTest, deltas ) {
    // Set as obsolete any message list that is filtered by
    // one of the removed or added mailboxes. If it's a simple query,
    // pre-emptively update it.
    var queries = store.getAllRemoteQueries();
    var l = queries.length;
    var query, filter, sort, delta;
    while ( l-- ) {
        query = queries[l];
        if ( query instanceof MessageList ) {
            filter = query.get( 'filter' );
            sort = query.get( 'sort' );
            if ( deltas && isFilteredJustOnMailbox( filter ) ) {
                delta = deltas[ filter.inMailbox ];
                if ( delta ) {
                    query.clientDidGenerateUpdate({
                        added: calculatePreemptiveAdd( query, delta.added ),
                        removed: delta.removed
                    });
                }
            } else if ( filterTest( filter ) || sortTest( sort ) ) {
                query.setObsolete();
            }
        }
    }
};

// ---

var identity = function ( v ) { return v; };

var addMoveInverse = function ( inverse, undoManager, willAdd, willRemove, messageSK ) {
    var l = willRemove ? willRemove.length : 1;
    var i, addMailboxId, removeMailboxId, data;
    for ( i = 0; i < l; i += 1 ) {
        addMailboxId = willAdd ? willAdd[0].get( 'id' ) : '-';
        removeMailboxId = willRemove ? willRemove[i].get( 'id' ) : '-';
        data = inverse[ addMailboxId + removeMailboxId ];
        if ( !data ) {
            data = {
                method: 'move',
                messageSKs: [],
                args: [
                    null,
                    willRemove && removeMailboxId,
                    willAdd && addMailboxId,
                    true
                ]
            };
            inverse[ addMailboxId + removeMailboxId ] = data;
            undoManager.pushUndoData( data );
        }
        data.messageSKs.push( messageSK );
        willAdd = null;
    }
};

// ---

var NO = 0;
var TO_MAILBOX = 1;
var TO_THREAD_IN_NOT_TRASH = 2;
var TO_THREAD_IN_TRASH = 4;
var TO_THREAD = (TO_THREAD_IN_NOT_TRASH|TO_THREAD_IN_TRASH);

var getMessages = function getMessages ( messageSKs, expand, mailbox, messageToThreadSK, callback, hasDoneLoad ) {
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
        var message = store.getRecord( Message, '#' + messageSK );
        var threadSK = messageToThreadSK[ messageSK ];
        var thread;
        if ( expand && threadSK ) {
            thread = store.getRecord( Thread, '#' + threadSK );
            if ( thread.is( READY ) ) {
                thread.get( 'messages' ).forEach( checkMessage );
            } else {
                allLoaded = false;
            }
        } else {
            checkMessage( message );
        }
    });

    if ( allLoaded || hasDoneLoad ) {
        JMAP.mail.gc.isPaused = false;
        callback( messages );
    } else {
        // Suspend gc and wait for next API request: guaranteed to load
        // everything
        JMAP.mail.gc.isPaused = true;
        JMAP.mail.addCallback(
            getMessages.bind( null,
                messageSKs, expand, mailbox, messageToThreadSK, callback, true )
        );
    }
    return true;
};

// ---

var doUndoAction = function ( method, args ) {
    return function ( callback, messages ) {
        var mail = JMAP.mail;
        if ( messages ) {
            args[0] = messages;
        }
        mail[ method ].apply( mail, args );
        callback( null );
    };
};

// ---

var roleIndex = new O.Object({
    index: null,
    clearIndex: function () {
        this.index = null;
    },
    buildIndex: function () {
        var index = this.index = store.getAll( Mailbox ).reduce(
            function ( index, mailbox ) {
                var role = mailbox.get( 'role' );
                if ( role ) {
                    index[ role ] = mailbox.get( 'id' );
                }
                return index;
            }, {} );
        return index;
    },
    getIndex: function () {
        return this.index || this.buildIndex();
    }
});
store.on( Mailbox, roleIndex, 'clearIndex' );

// ---

Object.assign( JMAP.mail, {

    getMessages: getMessages,

    getMailboxIdForRole: function ( role ) {
        return roleIndex.getIndex()[ role ] || null;
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
                var queries = store.getAllRemoteQueries(),
                    l = queries.length,
                    query;
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
                        getMessages.bind( null, messageSKs, NO, null, {} ) );
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
        var trashId = this.getMailboxIdForRole( 'trash' );
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
            if ( message.get( 'isUnread' ) === isUnread ) {
                return;
            }

            // Get the thread and cache the current unread state
            var thread = message.get( 'thread' );
            var isInTrash = message.get( 'isInTrash' );
            var isInNotTrash = message.get( 'isInNotTrash' );
            var threadUnreadInTrash =
                isInTrash && thread && thread.get( 'isUnreadInTrash' ) ?
                1 : 0;
            var threadUnreadInNotTrash =
                isInNotTrash && thread && thread.get( 'isUnreadInNotTrash' ) ?
                1 : 0;
            var mailboxCounts, mailboxId, delta, unreadDelta;

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
                var mailboxId = mailbox.get( 'id' );
                var delta = getMailboxDelta( mailboxDeltas, mailboxId );
                delta.unreadMessages += isUnread ? 1 : -1;
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
                for ( mailboxId in mailboxCounts ) {
                    unreadDelta = mailboxId === trashId ?
                        threadUnreadInTrash : threadUnreadInNotTrash;
                    if ( unreadDelta ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxId );
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

    setFlagged: function ( messages, isFlagged, allowUndo ) {
        var inverseMessageSKs = allowUndo ? [] : null;
        var inverse = allowUndo ? {
                method: 'setFlagged',
                messageSKs: inverseMessageSKs,
                args: [
                    null,
                    !isFlagged,
                    true
                ]
            } : null;

        messages.forEach( function ( message ) {
            // Check we have something to do
            if ( message.get( 'isFlagged' ) === isFlagged ) {
                return;
            }

            // Update the message
            message.set( 'isFlagged', isFlagged );

            // Add inverse for undo
            if ( allowUndo ) {
                inverseMessageSKs.push( message.get( 'storeKey' ) );
            }
        });

        // Update message list queries, or mark in need of refresh
        updateQueries( isFilteredOnFlagged, isSortedOnFlagged, null );

        if ( allowUndo && inverseMessageSKs.length ) {
            this.undoManager.pushUndoData( inverse );
        }

        return this;
    },

    move: function ( messages, addMailboxId, removeMailboxId, allowUndo ) {
        var mailboxDeltas = {};
        var inverse = allowUndo ? {} : null;
        var undoManager = this.undoManager;

        var addMailbox = addMailboxId ?
                store.getRecord( Mailbox, addMailboxId ) : null;
        var removeMailbox = removeMailboxId && removeMailboxId !== 'ALL' ?
                store.getRecord( Mailbox, removeMailboxId ) : null;
        var addMailboxOnlyIfNone = false;
        if ( !addMailbox ) {
            addMailboxOnlyIfNone = true;
            addMailbox = store.getRecord( Mailbox,
                this.getMailboxIdForRole( 'archive' ) ||
                this.getMailboxIdForRole( 'inbox' )
            );
        }

        // TODO: Check mailboxes still exist? Could in theory have been deleted.

        // Check we're not moving from/to the same place
        if ( addMailbox === removeMailbox && !addMailboxOnlyIfNone ) {
            return;
        }

        // Check ACLs
        if ( addMailbox && ( !addMailbox.is( READY ) ||
                !addMailbox.get( 'mayAddItems' ) ) ) {
            O.RunLoop.didError({
                name: 'JMAP.mail.move',
                message: 'May not add messages to ' + addMailbox.get( 'name' )
            });
            return this;
        }
        if ( removeMailbox && ( !removeMailbox.is( READY ) ||
                !removeMailbox.get( 'mayRemoveItems' ) ) ) {
            O.RunLoop.didError({
                name: 'JMAP.mail.move',
                message: 'May not remove messages from ' +
                    removeMailbox.get( 'name' )
            });
            return this;
        }

        messages.forEach( function ( message ) {
            var messageSK = message.get( 'storeKey' );
            var mailboxes = message.get( 'mailboxes' );

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

            var isUnread, thread;
            var deltaThreadUnreadInNotTrash, deltaThreadUnreadInTrash;
            var decrementMailboxCount, incrementMailboxCount;
            var delta, mailboxId, mailbox;

            // Calculate the changes required to the message's mailboxes
            if ( removeMailboxId === 'ALL' ) {
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
                return;
            }

            if ( addMailboxOnlyIfNone &&
                    willRemove.length !== mailboxes.get( 'length' ) ) {
                willAdd = null;
            }

            // Get the thread and cache the current unread state
            isUnread = message.get( 'isUnread' ) && !message.get( 'isDraft' );
            thread = message.get( 'thread' );
            if ( thread ) {
                wasThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                wasThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
            }

            // Update the message
            mailboxes.replaceObjectsAt(
                willRemove ? mailboxToRemoveIndex : mailboxes.get( 'length' ),
                willRemove ? willRemove.length : 0,
                willAdd
            );
            // FastMail specific
            if ( willRemove ) {
                message.set( 'previousFolderId', willRemove[0].get( 'id' ) );
            }
            // end

            if ( alreadyHasMailbox ) {
                willAdd = null;
                willRemove.erase( addMailbox );
            }

            // Add inverse for undo
            if ( allowUndo ) {
                addMoveInverse( inverse, undoManager,
                    willAdd, willRemove, messageSK );
            }

            // Calculate any changes to the mailbox message counts
            if ( thread ) {
                isThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );
                mailboxCounts = thread.get( 'mailboxCounts' );
            }

            decrementMailboxCount = function ( mailbox ) {
                var delta = getMailboxDelta(
                        mailboxDeltas, mailbox.get( 'id' ) );
                delta.removed.push( messageSK );
                delta.totalMessages -= 1;
                if ( isUnread ) {
                    delta.unreadMessages -= 1;
                }
                // If this was the last message in the thread in the mailbox
                if ( thread && !mailboxCounts[ mailboxId ] ) {
                    delta.totalThreads -= 1;
                    if ( mailbox.get( 'role' ) === 'trash' ?
                            wasThreadUnreadInTrash :
                            wasThreadUnreadInNotTrash ) {
                        delta.unreadThreads -= 1;
                    }
                }
            };
            incrementMailboxCount = function ( mailbox ) {
                var delta = getMailboxDelta(
                        mailboxDeltas, mailbox.get( 'id' ) );
                delta.added.push( message );
                delta.totalMessages += 1;
                if ( isUnread ) {
                    delta.unreadMessages += 1;
                }
                // If this was the first message in the thread in the
                // mailbox
                if ( thread && mailboxCounts[ mailboxId ] === 1 ) {
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
                for ( mailboxId in mailboxCounts ) {
                    mailbox = store.getRecord( Mailbox, mailboxId );
                    if ( mailboxCounts[ mailboxId ] > 1 ||
                            !willAdd.contains( mailbox ) ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxId );
                        if ( mailbox.get( 'role' ) === 'trash' ) {
                            delta.unreadThreads += deltaThreadUnreadInTrash;
                        } else {
                            delta.unreadThreads += deltaThreadUnreadInNotTrash;
                        }
                    }
                }
            }
        });

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( isFilteredOnMailboxes, isFalse, mailboxDeltas );

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
            var delta, mailboxId, mailbox, messageWasInMailbox, isTrash;

            // Get the thread and cache the current unread state
            isUnread = message.get( 'isUnread' ) && !message.get( 'isDraft' );
            thread = message.get( 'thread' );
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
                thread.refresh();

                // Calculate any changes to the mailbox message counts
                isThreadUnreadInNotTrash = thread.get( 'isUnreadInNotTrash' );
                isThreadUnreadInTrash = thread.get( 'isUnreadInTrash' );

                deltaThreadUnreadInNotTrash =
                    ( isThreadUnreadInNotTrash ? 1 : 0 ) -
                    ( wasThreadUnreadInNotTrash ? 1 : 0 );
                deltaThreadUnreadInTrash =
                    ( isThreadUnreadInTrash ? 1 : 0 ) -
                    ( wasThreadUnreadInTrash ? 1 : 0 );

                for ( mailboxId in mailboxCounts ) {
                    mailbox = store.getRecord( Mailbox, mailboxId );
                    messageWasInMailbox = mailboxes.contains( mailbox );
                    isTrash = mailbox.get( 'role' ) === 'trash';
                    if ( messageWasInMailbox ) {
                        delta = getMailboxDelta( mailboxDeltas, mailboxId );
                        delta.totalMessages -= 1;
                        if ( isUnread ) {
                            delta.unreadMessages -= 1;
                        }
                        delta.removed.push( messageSK );
                        if ( mailboxCounts[ mailboxId ] === 1 ) {
                            delta.totalThreads -= 1;
                        }
                    }
                    if ( isTrash && deltaThreadUnreadInTrash ) {
                        getMailboxDelta( mailboxDeltas, mailboxId )
                            .unreadThreads += deltaThreadUnreadInTrash;
                    } else if ( !isTrash && deltaThreadUnreadInNotTrash ) {
                        getMailboxDelta( mailboxDeltas, mailboxId )
                            .unreadThreads += deltaThreadUnreadInNotTrash;
                    }
                }
            } else {
                mailboxes.forEach( function ( mailbox ) {
                    var delta =
                        getMailboxDelta( mailboxDeltas, mailbox.get( 'id' ) );
                    delta.totalMessages -= 1;
                    if ( isUnread ) {
                        delta.unreadMessages -= 1;
                    }
                    delta.removed.push( messageSK );
                });
            }
        });

        // Update counts on mailboxes
        updateMailboxCounts( mailboxDeltas );

        // Update message list queries, or mark in need of refresh
        updateQueries( isTrue, isFalse, mailboxDeltas );

        return this;
    },

    report: function ( messages, asSpam, allowUndo ) {
        var messageIds = [];
        var messageSKs = [];

        messages.forEach( function ( message ) {
            messageIds.push( message.get( 'id' ) );
            messageSKs.push( message.get( 'storeKey' ) );
        });

        this.callMethod( 'reportMessages', {
            messageIds: messageIds,
            asSpam: asSpam
        });

        if ( allowUndo ) {
            this.undoManager.pushUndoData({
                method: 'reportMessages',
                messageSKs: messageSKs,
                args: [
                    null,
                    !asSpam,
                    true
                ]
            });
        }

        return this;
    },

    // ---

    saveDraft: function ( message ) {
        var inReplyToMessageId = message.get( 'inReplyToMessageId' );
        var inReplyToMessage = null;
        var thread = null;
        var messages = null;
        var isFirstDraft = true;
        if ( inReplyToMessageId &&
                ( store.getRecordStatus(
                    Message, inReplyToMessageId ) & READY ) ) {
            inReplyToMessage = store.getRecord( Message, inReplyToMessageId );
            thread = inReplyToMessage.get( 'thread' );
            if ( thread && thread.is( READY ) ) {
                messages = thread.get( 'messages' );
            }
        }

        // Save message
        message.get( 'mailboxes' ).add(
            store.getRecord( Mailbox, this.getMailboxIdForRole( 'drafts' ) )
        );
        message.saveToStore();

        // Pre-emptively update thread
        if ( messages ) {
            isFirstDraft = !messages.some( function ( message ) {
                return message.isIn( 'drafts' );
            });
            messages.replaceObjectsAt(
                messages.indexOf( inReplyToMessage ) + 1, 0, [ message ] );
            thread.refresh();
        }

        // Pre-emptively update draft mailbox counts
        store.getRecord( Mailbox, this.getMailboxIdForRole( 'drafts' ) )
            .increment( 'totalMessages', 1 )
            .increment( 'totalThreads', isFirstDraft ? 1 : 0 )
            .setObsolete()
            .refresh();

        return this;
    }
});

}( JMAP ) );
