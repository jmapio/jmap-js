// -------------------------------------------------------------------------- \\
// File: Message.js                                                           \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js                                                  \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP, undefined ) {

var Status = O.Status,
    EMPTY = Status.EMPTY,
    READY = Status.READY,
    NEW = Status.NEW;

var Record = O.Record,
    attr = Record.attr;

var MessageDetails = O.Class({ Extends: Record });

var Message = O.Class({

    Extends: Record,

    threadId: attr( String ),

    thread: function () {
        var threadId = this.get( 'threadId' );
        return threadId ?
            this.get( 'store' ).getRecord( JMAP.Thread, threadId ) : null;
    }.property( 'threadId' ).nocache(),

    mailboxes: Record.toMany({
        recordType: JMAP.Mailbox,
        key: 'mailboxIds'
    }),

    isUnread: attr( Boolean ),
    isFlagged: attr( Boolean ),
    isAnswered: attr( Boolean ),
    isDraft: attr( Boolean ),
    hasAttachment: attr( Boolean ),

    sender: attr( Object ),
    from: attr( Array ),
    to: attr( Array ),
    subject: attr( String ),
    date: attr( Date ),

    size: attr( Number ),

    preview: attr( String ),

    // ---

    isIn: function ( role ) {
        return this.get( 'mailboxes' ).some( function ( mailbox ) {
            return mailbox.get( 'role' ) === role;
        });
    },
    isInTrash: function () {
        return this.isIn( 'trash' );
    }.property( 'mailboxes' ),

    notifyThread: function () {
        var threadId = this.get( 'threadId' ),
            store = this.get( 'store' );
        if ( threadId &&
                ( store.getRecordStatus( JMAP.Thread, threadId ) & READY ) ) {
            this.get( 'thread' ).propertyDidChange( 'messages' );
        }
    }.queue( 'before' ).observes( 'mailboxes',
        'isUnread', 'isFlagged', 'isDraft', 'hasAttachment' ),

    // ---

    fromName: function () {
        var from = this.get( 'from' );
        var emailer = from && from [0] || null;
        return emailer ? emailer.name || emailer.email.split( '@' )[0] : '';
    }.property( 'from' ),

    fromEmail: function () {
        var from = this.get( 'from' );
        var emailer = from && from [0] || null;
        return emailer ? emailer.email : '';
    }.property( 'from' ),

    // ---

    fullDate: function () {
        var date = this.get( 'date' );
        return O.i18n.date( date, 'fullDateAndTime' );
    }.property( 'date' ),

    relativeDate: function () {
        var date = this.get( 'date' ),
            now = new Date();
        // As the server clock may not be exactly in sync with the client's
        // clock, it's possible to get a message which appears to be dated a
        // few seconds into the future! Make sure we always display this as
        // a few minutes ago instead.
        return date < now ?
            date.relativeTo( now, true ) :
            now.relativeTo( date, true );
    }.property().nocache(),

    formattedSize: function () {
        return O.i18n.fileSize( this.get( 'size' ), 1 );
    }.property( 'size' ),

    // ---

    detailsStatus: function ( status ) {
        if ( status !== undefined ) {
            return status;
        }
        if ( this.get( 'blobId' ) || this.is( NEW ) ) {
            return READY;
        }
        return EMPTY;
    }.property( 'blobId' ),

    fetchDetails: function () {
        if ( this.get( 'detailsStatus' ) === EMPTY ) {
            JMAP.mail.fetchRecord( MessageDetails, this.get( 'id' ) );
        }
    },

    blobId: attr( String ),

    inReplyToMessageId: attr( String ),

    headers: attr( Object, {
        defaultValue: {}
    }),

    cc: attr( Array ),
    bcc: attr( Array ),
    replyTo: attr( Array ),

    textBody: attr( String ),
    htmlBody: attr( String ),

    attachments: attr( Array ),
    attachedMessages: attr( Object ),
    attachedInvites: attr( Object )
}).extend({
    headerProperties: [
        'threadId',
        'mailboxIds',
        'isUnread',
        'isFlagged',
        'isAnswered',
        'isDraft',
        'hasAttachment',
        'from',
        'to',
        'subject',
        'date',
        'size',
        'preview'
    ],
    detailsProperties: [
        'blobId',
        'inReplyToMessageId',
        'headers.list-id',
        'headers.list-post',
        'sender',
        'cc',
        'bcc',
        'replyTo',
        'body',
        'attachments',
        'attachedMessages',
        'attachedInvites'
    ],
    Details: MessageDetails
});

JMAP.mail.handle( MessageDetails, {
    fetch: function ( ids ) {
        this.callMethod( 'getMessages', {
            ids: ids,
            properties: Message.detailsProperties
        });
    }
});

JMAP.mail.messageUpdateFetchRecords = true;
JMAP.mail.messageUpdateMaxChanges = 50;
JMAP.mail.handle( Message, {
    fetch: function ( ids ) {
        this.callMethod( 'getMessages', {
            ids: ids,
            properties: Message.headerProperties
        });
    },
    refresh: function ( ids, state ) {
        if ( ids ) {
            this.callMethod( 'getMessages', {
                ids: ids,
                properties: [
                    'mailboxIds',
                    'isUnread',
                    'isFlagged',
                    'isAnswered',
                    'isDraft',
                    'hasAttachment'
                ]
            });
        } else {
            var messageUpdateFetchRecords = this.messageUpdateFetchRecords;
            this.callMethod( 'getMessageUpdates', {
                sinceState: state,
                maxChanges: this.messageUpdateMaxChanges,
                fetchRecords: messageUpdateFetchRecords,
                fetchRecordProperties: messageUpdateFetchRecords ?
                    Message.headerProperties : null
            });
        }
    },
    commit: 'setMessages',

    // ---

    messages: function ( args ) {
        var first = args.list[0],
            updates;
        if ( first && first.date ) {
            this.didFetch( Message, args );
        } else {
            updates = args.list.reduce( function ( updates, message ) {
                updates[ message.id ] = message;
                return updates;
            }, {} );
            this.get( 'store' )
                .sourceDidFetchPartialRecords( Message, updates );
        }
    },
    messageUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( Message, args, reqArgs );
        if ( !reqArgs.fetchRecords ) {
            this.recalculateAllFetchedWindows();
        }
        if ( args.hasMoreUpdates ) {
            var messageUpdateMaxChanges = this.messageUpdateMaxChanges;
            if ( messageUpdateMaxChanges < 150 ) {
                if ( messageUpdateMaxChanges === 50 ) {
                    // Keep fetching updates, just without records
                    this.messageUpdateFetchRecords = false;
                    this.messageUpdateMaxChanges = 100;
                } else {
                    this.messageUpdateMaxChanges = 150;
                }
                this.get( 'store' ).fetchAll( Message, true );
                return;
            } else {
                // We've fetched 300 updates and there's still more. Let's give
                // up and reset.
                this.response
                    .error_getMessageUpdates_cannotCalculateChanges
                    .call( this, args );
            }
        }
        this.messageUpdateFetchRecords = true;
        this.messageUpdateMaxChanges = 50;
    },
    error_getMessageUpdates_cannotCalculateChanges: function ( args ) {
        var store = this.get( 'store' );
        // All our data may be wrong. Mark all messages as obsolete.
        // The garbage collector will eventually clean up any messages that
        // no longer exist
        store.getAll( Message ).forEach( function ( message ) {
            message.setObsolete();
        });
        this.recalculateAllFetchedWindows();
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            Message, null, null, store.getTypeState( Message ), args.newState );

    },
    messagesSet: function ( args ) {
        this.didCommit( Message, args );
    }
});

JMAP.Message = Message;

}( JMAP ) );
