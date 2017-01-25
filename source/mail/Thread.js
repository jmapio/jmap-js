// -------------------------------------------------------------------------- \\
// File: Thread.js                                                            \\
// Module: MailModel                                                          \\
// Requires: API, Message.js                                                  \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP ) {

var Record = O.Record;

// ---

var isInTrash = function ( message ) {
    return message.get( 'isInTrash' );
};
var isInNotTrash = function ( message ) {
    return message.get( 'isInNotTrash' );
};

var aggregateBoolean = function ( _, key ) {
    return this.get( 'messages' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

var aggregateBooleanInNotTrash = function ( _, key ) {
    return this.get( 'messagesInNotTrash' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

var aggregateBooleanInTrash = function ( _, key ) {
    return this.get( 'messagesInTrash' ).reduce(
    function ( isProperty, message ) {
        return isProperty || message.get( key );
    }, false );
}.property( 'messages' ).nocache();

var total = function( property ) {
    return function () {
        return this.get( property ).get( 'length' );
    }.property( 'messages' ).nocache();
};

// senders is [{name: String, email: String}]
var toFrom = function ( message ) {
    var from = message.get( 'from' );
    return from && from[0] || null;
};
var senders = function( property ) {
    return function () {
        return this.get( property )
                   .map( toFrom )
                   .filter( O.Transform.toBoolean );
    }.property( 'messages' ).nocache();
};

var sumSize = function ( size, message ) {
    return size + message.get( 'size' );
};
var size = function( property ) {
    return function () {
        return this.get( property ).reduce( sumSize, 0 );
    }.property( 'messages' ).nocache();
};

var Thread = O.Class({

    Extends: Record,

    isEditable: false,

    messages: Record.toMany({
        recordType: JMAP.Message,
        key: 'messageIds'
    }),

    messagesInNotTrash: function () {
        return new O.ObservableArray(
            this.get( 'messages' ).filter( isInNotTrash )
        );
    }.property(),

    messagesInTrash: function () {
        return new O.ObservableArray(
            this.get( 'messages' ).filter( isInTrash )
         );
    }.property(),

    _setMessagesArrayContent: function () {
        var cache = O.meta( this ).cache;
        var messagesInNotTrash = cache.messagesInNotTrash;
        var messagesInTrash = cache.messagesInTrash;
        if ( messagesInNotTrash ) {
            messagesInNotTrash.set( '[]',
                this.get( 'messages' ).filter( isInNotTrash )
            );
        }
        if ( messagesInTrash ) {
            messagesInTrash.set( '[]',
                this.get( 'messages' ).filter( isInTrash )
            );
        }
    }.observes( 'messages' ),

    isAll: function ( status ) {
        return this.is( status ) &&
            this.get( 'messages' ).every( function ( message ) {
                return message.is( status );
            });
    },

    // Note: API Mail mutates this value; do not cache.
    mailboxCounts: function () {
        var counts = {};
        this.get( 'messages' ).forEach( function ( message ) {
            message.get( 'mailboxes' ).forEach( function ( mailbox ) {
                var id = mailbox.get( 'id' );
                counts[ id ] = ( counts[ id ] ||  0 ) + 1;
            });
        });
        return counts;
    }.property( 'messages' ).nocache(),

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

JMAP.mail.threadUpdateFetchRecords = true;
JMAP.mail.threadUpdateMaxChanges = 30;
JMAP.mail.handle( Thread, {
    fetch: function ( ids ) {
        this.callMethod( 'getThreads', {
            ids: ids,
            fetchMessages: true,
            fetchMessageProperties: JMAP.Message.headerProperties
        });
    },
    refresh: function ( ids, state ) {
        if ( ids ) {
            this.fetchRecords( Thread, ids );
        } else {
            this.callMethod( 'getThreadUpdates', {
                sinceState: state,
                maxChanges: this.threadUpdateMaxChanges,
                fetchRecords: this.threadUpdateFetchRecords
            });
        }
    },
    // Response handler
    threads: function ( args ) {
        this.didFetch( Thread, args );
    },
    threadUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( Thread, args, reqArgs );
        if ( !reqArgs.fetchRecords ) {
            this.recalculateAllFetchedWindows();
        }
        if ( args.hasMoreUpdates ) {
            var threadUpdateMaxChanges = this.threadUpdateMaxChanges;
            if ( threadUpdateMaxChanges < 120 ) {
                if ( threadUpdateMaxChanges === 30 ) {
                    // Keep fetching updates, just without records
                    this.threadUpdateFetchRecords = false;
                    this.threadUpdateMaxChanges = 100;
                } else {
                    this.threadUpdateMaxChanges = 120;
                }
                this.get( 'store' ).fetchAll( Thread, true );
                return;
            } else {
                // We've fetched 250 updates and there's still more. Let's give
                // up and reset.
                this.response
                    .error_getThreadUpdates_cannotCalculateChanges
                    .call( this, args );
            }
        }
        this.threadUpdateFetchRecords = true;
        this.threadUpdateMaxChanges = 30;
    },
    error_getThreadUpdates_cannotCalculateChanges: function (/* args */) {
        var store = this.get( 'store' );
        // All our data may be wrong. Unload if possible, otherwise mark
        // obsolete.
        store.getAll( Thread ).forEach( function ( thread ) {
            if ( !store.unloadRecord( thread.get( 'storeKey' ) ) ) {
                thread.setObsolete();
            }
        });
        this.recalculateAllFetchedWindows();
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            Thread, null, null, store.getTypeState( Thread ), '' );
    }
});

JMAP.Thread = Thread;

}( JMAP ) );
