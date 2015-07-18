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

    from: attr( Object ),
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
        return from ? from.name || from.email.split( '@' )[0] : '';
    }.property( 'from' ),

    fromEmail: function () {
        var from = this.get( 'from' );
        return from ? from.email : '';
    }.property( 'from' ),

    // ---

    detailsStatus: function ( status ) {
        if ( status !== undefined ) {
            return status;
        }
        if ( this.get( 'rawUrl' ) || this.is( NEW ) ) {
            return READY;
        }
        return EMPTY;
    }.property( 'rawUrl' ),

    fetchDetails: function () {
        if ( this.get( 'detailsStatus' ) === EMPTY ) {
            JMAP.mail.fetchRecord( MessageDetails, this.get( 'id' ) );
        }
    },

    inReplyToMessageId: attr( String ),

    rawUrl: attr( String ),

    headers: attr( Object, {
        defaultValue: {}
    }),

    cc: attr( Array ),
    bcc: attr( Array ),
    replyTo: attr( Object ),

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
        'inReplyToMessageId',
        'rawUrl',
        'headers.List-Id',
        'headers.List-Post',
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
            this.callMethod( 'getMessageUpdates', {
                sinceState: state,
                maxChanges: 50,
                fetchRecords: true,
                fetchRecordProperties: Message.headerProperties
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
    messageUpdates: function ( args ) {
        this.didFetchUpdates( Message, args );
    },
    error_getMessageUpdates_cannotCalculateChanges: function () {
        this.response.error_getMessageUpdates_tooManyChanges.call( this );
    },
    error_getMessageUpdates_tooManyChanges: function () {
        var store = this.get( 'store' );
        // All our data may be wrong. Mark all messages as obsolete.
        store.getAll( Message ).forEach( function ( message ) {
            message.setObsolete();
        });
        // Mark all message lists as needing to recheck if window is fetched.
        store.getAllRemoteQueries().forEach( function ( query ) {
            if ( query instanceof JMAP.MessageList ) {
                query.recalculateFetchedWindows();
            }
        });
    },
    messagesSet: function ( args ) {
        this.didCommit( Message, args );
    }
});

JMAP.Message = Message;

}( JMAP ) );
