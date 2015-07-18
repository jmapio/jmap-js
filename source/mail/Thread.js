// -------------------------------------------------------------------------- \\
// File: Thread.js                                                            \\
// Module: MailModel                                                          \\
// Requires: API, Message.js                                                  \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. All rights reserved.                \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP ) {

var Record = O.Record;

var aggregateBoolean = function ( _, key ) {
    return this.get( 'messages' ).reduce( function ( isProperty, message ) {
        return isProperty || ( !message.isIn( 'trash' ) && message.get( key ) );
    }, false );
}.property( 'messages' ).nocache();

var aggregateBooleanInTrash = function ( _, key ) {
    return this.get( 'messages' ).reduce( function ( isProperty, message ) {
        return isProperty || ( message.isIn( 'trash' ) && message.get( key ) );
    }, false );
}.property( 'messages' ).nocache();

var Thread = O.Class({

    Extends: Record,

    isEditable: false,

    messages: Record.toMany({
        recordType: JMAP.Message,
        key: 'messageIds'
    }),

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
                if ( message.get( 'isInTrash' ) &&
                        mailbox.get( 'role' ) !== 'trash' ) {
                    return;
                }
                counts[ id ] = ( counts[ id ] ||  0 ) + 1;
            });
        });
        return counts;
    }.property( 'messages' ).nocache(),

    isUnread: aggregateBoolean,
    isFlagged: aggregateBoolean,
    isDraft: aggregateBoolean,
    hasAttachment: aggregateBoolean,

    total: function () {
        return this.get( 'messages' ).reduce( function ( count, message ) {
            return count + ( message.isIn( 'trash' ) ? 0 : 1 );
        }, 0 );
    }.property( 'messages' ).nocache(),

    // senders is [{name: String, email: String}]
    senders: function () {
        return this.get( 'messages' ).map( function ( message ) {
            return message.isIn( 'trash' ) ? null : message.get( 'from' );
        }).filter( O.Transform.toBoolean );
    }.property( 'messages' ).nocache(),

    size: function () {
        return this.get( 'messages' ).reduce( function ( size, message ) {
            return size +
                ( message.isIn( 'trash' ) ? 0 : message.get( 'size' ) );
        }, 0 );
    }.property( 'messages' ).nocache(),

    // ---

    isUnreadInTrash: aggregateBooleanInTrash,
    isFlaggedInTrash: aggregateBooleanInTrash,
    isDraftInTrash: aggregateBooleanInTrash,
    hasAttachmentInTrash: aggregateBooleanInTrash,

    totalInTrash: function () {
        return this.get( 'messages' ).reduce( function ( count, message ) {
            return count + ( message.isIn( 'trash' ) ? 1 : 0 );
        }, 0 );
    }.property( 'messages' ).nocache(),

    sendersInTrash: function () {
        return this.get( 'messages' ).map( function ( message ) {
            return message.isIn( 'trash' ) ? message.get( 'from' ) : null;
        }).filter( O.Transform.toBoolean );
    }.property( 'messages' ).nocache(),

    sizeInTrash: function () {
        return this.get( 'messages' ).reduce( function ( size, message ) {
            return size +
                ( message.isIn( 'trash' ) ? message.get( 'size' ) : 0 );
        }, 0 );
    }.property( 'messages' ).nocache()
});

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
                maxChanges: 30,
                fetchRecords: true
            });
        }
    },
    // Response handler
    threads: function ( args ) {
        this.didFetch( Thread, args );
    },
    threadUpdates: function ( args ) {
        this.didFetchUpdates( Thread, args );
    },
    error_getThreadUpdates_cannotCalculateChanges: function () {
        this.response.error_getThreadUpdates_tooManyChanges.call( this );
    },
    error_getThreadUpdates_tooManyChanges: function () {
        var store = this.get( 'store' );
        // All our data may be wrong. Unload if possible, otherwise mark
        // obsolete.
        store.getAll( Thread ).forEach( function ( thread ) {
            if ( !store.unloadRecord( thread.get( 'storeKey' ) ) ) {
                thread.setObsolete();
            }
        });
        // Mark all message lists as needing to recheck if window is fetched.
        store.getAllRemoteQueries().forEach( function ( query ) {
            if ( query instanceof JMAP.MessageList ) {
                query.recalculateFetchedWindows();
            }
        });
    }
});

JMAP.Thread = Thread;

}( JMAP ) );
