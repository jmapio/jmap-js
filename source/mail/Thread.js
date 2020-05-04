// -------------------------------------------------------------------------- \\
// File: Thread.js                                                            \\
// Module: MailModel                                                          \\
// Requires: API, Message.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const meta = O.meta;
const Class = O.Class;
const Obj = O.Object;
const Enumerable = O.Enumerable;
const ObservableRange = O.ObservableRange;
const Record = O.Record;
const READY = O.Status.READY;

const Message = JMAP.Message;

// ---

const isInTrash = function ( message ) {
    return message.is( READY ) && message.get( 'isInTrash' );
};
const isInNotTrash = function ( message ) {
    return message.is( READY ) && message.get( 'isInNotTrash' );
};

const aggregateBoolean = function ( _, key ) {
    return this.get( 'messages' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const aggregateBooleanInNotTrash = function ( _, key ) {
    key = key.slice( 0, -10 );
    return this.get( 'messagesInNotTrash' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const aggregateBooleanInTrash = function ( _, key ) {
    key = key.slice( 0, -7 );
    return this.get( 'messagesInTrash' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

const total = function( property ) {
    return function () {
        return this.get( property ).get( 'length' );
    }.property( 'messages' ).nocache();
};

// senders is [{name: String, email: String}]
const toFrom = function ( message ) {
    var from = message.get( 'from' );
    return from && from[0] || null;
};
const senders = function( property ) {
    return function () {
        return this.get( property )
                   .map( toFrom )
                   .filter( O.Transform.toBoolean );
    }.property( 'messages' ).nocache();
};

const sumSize = function ( size, message ) {
    return size + ( message.get( 'size' ) || 0 );
};
const size = function( property ) {
    return function () {
        return this.get( property ).reduce( sumSize, 0 );
    }.property( 'messages' ).nocache();
};

// ---

const MessageArray = Class({

    Extends: Obj,

    Mixin: [ ObservableRange, Enumerable ],

    init: function ( store, storeKeys ) {
        this._store = store;
        this._storeKeys = storeKeys;

        MessageArray.parent.constructor.call( this );
    },

    length: function () {
        return this._storeKeys.length;
    }.property().nocache(),

    getObjectAt ( index ) {
        var storeKey = this._storeKeys[ index ];
        if ( storeKey ) {
            return this._store.materialiseRecord( storeKey );
        }
    },

    update: function ( storeKeys ) {
        var oldStoreKeys = this._storeKeys;
        var oldLength = oldStoreKeys.length;
        var newLength = storeKeys.length;
        var start = 0;
        var end = newLength;

        this._storeKeys = storeKeys;

        while ( ( start < newLength ) &&
                ( storeKeys[ start ] === oldStoreKeys[ start ] ) ) {
            start += 1;
        }
        if ( newLength === oldLength ) {
            var last = end - 1;
            while ( ( end > start ) &&
                    ( storeKeys[ last ] === oldStoreKeys[ last ] ) ) {
                end = last;
                last -= 1;
            }
        } else {
            end = Math.max( oldLength, newLength );
            this.propertyDidChange( 'length', oldLength, newLength );
        }

        if ( start !== end ) {
            this.rangeDidChange( start, end );
        }
        return this;
    },
});

const toStoreKey = function ( record ) {
    return record.get( 'storeKey' );
};

// ---

const Thread = Class({

    Extends: Record,

    messages: Record.toMany({
        recordType: Message,
        key: 'emailIds',
        isNullable: false,
        noSync: true,
    }),

    messagesInNotTrash: function () {
        return new MessageArray(
            this.get( 'store' ),
            this.get( 'messages' ).filter( isInNotTrash ).map( toStoreKey )
        );
    }.property(),

    messagesInTrash: function () {
        return new MessageArray(
            this.get( 'store' ),
            this.get( 'messages' ).filter( isInTrash ).map( toStoreKey )
         );
    }.property(),

    _setSubsetMessagesContent: function () {
        var cache = meta( this ).cache;
        var messagesInNotTrash = cache.messagesInNotTrash;
        var messagesInTrash = cache.messagesInTrash;
        if ( messagesInNotTrash ) {
            messagesInNotTrash.update(
                this.get( 'messages' ).filter( isInNotTrash ).map( toStoreKey )
            );
        }
        if ( messagesInTrash ) {
            messagesInTrash.update(
                this.get( 'messages' ).filter( isInTrash ).map( toStoreKey )
            );
        }
    }.observes( 'messages' ),

    isAll: function ( status ) {
        return this.is( status ) &&
            // .reduce instead of .every so we deliberately fetch every record
            // object from the store, triggering a fetch if not loaded
            this.get( 'messages' ).reduce( function ( isStatus, message ) {
                return isStatus && message.is( status );
            }, true );
    },

    mailboxCounts: function () {
        var counts = {};
        this.get( 'messages' ).forEach( function ( message ) {
            message.get( 'mailboxes' ).forEach( function ( mailbox ) {
                var storeKey = mailbox.get( 'storeKey' );
                counts[ storeKey ] = ( counts[ storeKey ] ||  0 ) + 1;
            });
        });
        return counts;
    }.property( 'messages' ),

    // ---

    isUnread: aggregateBoolean,
    isFlagged: aggregateBoolean,
    isDraft: aggregateBoolean,
    hasAttachment: aggregateBoolean,

    total: total( 'messages' ),
    senders: senders( 'messages' ),
    size: size( 'messages' ),

    // ---

    isUnreadInNotTrash: aggregateBooleanInNotTrash,
    isFlaggedInNotTrash: aggregateBooleanInNotTrash,
    isDraftInNotTrash: aggregateBooleanInNotTrash,
    hasAttachmentInNotTrash: aggregateBooleanInNotTrash,

    totalInNotTrash: total( 'messagesInNotTrash' ),
    sendersInNotTrash: senders( 'messagesInNotTrash' ),
    sizeInNotTrash: size( 'messagesInNotTrash' ),

    // ---

    isUnreadInTrash: aggregateBooleanInTrash,
    isFlaggedInTrash: aggregateBooleanInTrash,
    isDraftInTrash: aggregateBooleanInTrash,
    hasAttachmentInTrash: aggregateBooleanInTrash,

    totalInTrash: total( 'messagesInTrash' ),
    sendersInTrash: senders( 'messagesInTrash' ),
    sizeInTrash: size( 'messagesInTrash' )
});
Thread.__guid__ = 'Thread';
Thread.dataGroup = 'urn:ietf:params:jmap:mail';

JMAP.mail.threadChangesMaxChanges = 50;
JMAP.mail.handle( Thread, {

    fetch: function ( accountId, ids ) {
        // Called with ids == null if you try to refresh before we have any
        // data loaded. Just ignore.
        if ( ids ) {
            this.callMethod( 'Thread/get', {
                accountId: accountId,
                ids: ids,
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
        }
    },

    refresh: function ( accountId, ids, state ) {
        if ( ids ) {
            this.callMethod( 'Thread/get', {
                accountId: accountId,
                ids: ids,
            });
        } else {
            this.callMethod( 'Thread/changes', {
                accountId: accountId,
                sinceState: state,
                maxChanges: this.threadChangesMaxChanges,
            });
        }
    },

    //  ---

    'Thread/get': function ( args ) {
        this.didFetch( Thread, args, false );
    },

    'Thread/changes': function ( args ) {
        this.didFetchUpdates( Thread, args, false );
        if ( args.updated && args.updated.length ) {
            this.recalculateAllFetchedWindows();
        }
        if ( args.hasMoreChanges ) {
            const threadChangesMaxChanges = this.threadChangesMaxChanges;
            if ( threadChangesMaxChanges < 150 ) {
                if ( threadChangesMaxChanges === 50 ) {
                    this.threadChangesMaxChanges = 100;
                } else {
                    this.threadChangesMaxChanges = 150;
                }
                this.fetchMoreChanges( args.accountId, Thread );
                return;
            } else {
                // We've fetched 300 updates and there's still more. Let's give
                // up and reset.
                this.response[ 'error_Thread/changes_cannotCalculateChanges' ]
                    .apply( this, arguments );
            }
        }
        this.threadChangesMaxChanges = 50;
    },

    'error_Thread/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Unload if possible, otherwise mark
        // obsolete.
        store.getAll( Thread ).forEach( function ( thread ) {
            if ( thread.get( 'accountId' ) === accountId ) {
                if ( !store.unloadRecord( thread.get( 'storeKey' ) ) ) {
                    thread.setObsolete();
                }
            }
        });
        this.recalculateAllFetchedWindows();
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            accountId, Thread, null, null,
            store.getTypeState( accountId, Thread ), ''
        );
    },
});

// ---

// Circular dependency
Message.prototype.thread.Type = Thread;

// --- Export

JMAP.Thread = Thread;

}( JMAP ) );
