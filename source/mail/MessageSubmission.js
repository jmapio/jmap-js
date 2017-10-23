// -------------------------------------------------------------------------- \\
// File: MessageSubmission.js                                                 \\
// Module: MailModel                                                          \\
// Requires: API, Message.js, Thread.js, Identity.js                          \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Record = O.Record;
const attr = Record.attr;

const Identity = JMAP.Identity;
const Message = JMAP.Message;
const Thread = JMAP.Thread;
const makeSetRequest = JMAP.Connection.makeSetRequest;

// ---

const MessageSubmission = O.Class({

    Extends: Record,

    identity: Record.toOne({
        Type: Identity,
        key: 'identityId',
    }),

    message: Record.toOne({
        Type: Message,
        key: 'messageId',
    }),

    thread: Record.toOne({
        Type: Thread,
        key: 'threadId',
        noSync: true,
    }),

    envelope: attr( Object, {
        defaultValue: null,
    }),

    sendAt: attr( Date, {
        noSync: true,
    }),

    undoStatus: attr( String, {
        noSync: true,
        defaultValue: 'pending',
    }),

    deliveryStatus: attr( Object, {
        noSync: true,
        defaultValue: null,
    }),

    dsnBlobIds: attr( Array ),
    mdnBlobIds: attr( Array ),

    // ---

    // Not a real JMAP property; stripped before sending to server.
    onSuccess: attr( Object ),
});

MessageSubmission.makeEnvelope = function ( message ) {
    var sender = message.get( 'sender' );
    var mailFrom = {
        email: sender ?
            sender.email :
            message.get( 'fromEmail' ),
        parameters: null,
    };
    var seen = {};
    var rcptTo = [ 'to', 'cc', 'bcc' ].reduce( function ( rcptTo, header ) {
        var addresses = message.get( header );
        if ( addresses ) {
            addresses.forEach( function ( address ) {
                var email = address.email;
                if ( email && !seen[ email ] ) {
                    seen[ email ] = true;
                    rcptTo.push({ email: email, parameters: null });
                }
            });
        }
        return rcptTo;
    }, [] );
    return {
        mailFrom: mailFrom,
        rcptTo: rcptTo,
    };
};


JMAP.mail.handle( MessageSubmission, {

    precedence: 3,

    fetch: function ( ids ) {
        this.callMethod( 'getMessageSubmissions', {
            ids: ids || [],
        });
    },

    refresh: function ( ids, state ) {
        if ( ids ) {
            this.callMethod( 'getMessageSubmissions', {
                ids: ids,
            });
        } else {
            this.callMethod( 'getMessageSubmissionUpdates', {
                sinceState: state,
                maxChanges: 50,
            });
            this.callMethod( 'getMessageSubmissions', {
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    path: '/changed',
                },
            });
        }
    },

    commit: function ( change ) {
        var store = this.get( 'store' );
        var args = makeSetRequest( change );

        // TODO: Prevent double sending if dodgy connection
        // if ( Object.keys( args.create ).length ) {
        //     args.ifInState = change.state;
        // }

        var onSuccessUpdateMessage = {};
        var onSuccessDestroyMessage = {};
        var create = args.create;
        var update = args.update;
        var id, submission;

        var draftsId = this.getMailboxIdForRole( 'drafts' );
        var sentId = this.getMailboxIdForRole( 'sent' );
        var updateMessage = {};
        updateMessage[ 'mailboxIds/' + sentId ] = null;
        updateMessage[ 'mailboxIds/' + draftsId ] = true;
        updateMessage[ 'keywords/$Draft' ] = true;

        // On create move from drafts, remove $Draft keyword
        for ( id in create ) {
            submission = create[ id ];
            if ( submission.onSuccess === null ) {
                args.onSuccessDestroyMessage = onSuccessDestroyMessage;
                onSuccessDestroyMessage.push( '#' + id );
            } else if ( submission.onSuccess ) {
                args.onSuccessUpdateMessage = onSuccessUpdateMessage;
                onSuccessUpdateMessage[ '#' + id ] = submission.onSuccess;
            }
            delete submission.onSuccess;
        }

        // On unsend, move back to drafts, set $Draft keyword.
        for ( id in update ) {
            submission = update[ id ];
            if ( submission.undoStatus === 'canceled' ) {
                args.onSuccessUpdateMessage = onSuccessUpdateMessage;
                onSuccessUpdateMessage[ submission.id ] = updateMessage;
            }
        }

        this.callMethod( 'setMessageSubmissions', args );
        if ( args.onSuccessUpdateMessage || args.onSuccessDestroyMessage ) {
            this.fetchAllRecords( Message, store.getTypeState( Message ) );
        }
    },

    // ---

    messageSubmissions: function ( args ) {
        this.didFetch( MessageSubmission, args );
    },

    messageSubmissionUpdates: function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( MessageSubmission, args, hasDataForChanged );
        if ( args.hasMoreUpdates ) {
            this.get( 'store' ).fetchAll( MessageSubmission, true );
        }
    },

    error_getMessageSubmissionUpdates_cannotCalculateChanges: function ( /* args */ ) {
        var store = this.get( 'store' );
        // All our data may be wrong. Unload if possible, otherwise mark
        // obsolete.
        store.getAll( MessageSubmission ).forEach( function ( submission ) {
            if ( !store.unloadRecord( submission.get( 'storeKey' ) ) ) {
                submission.setObsolete();
            }
        });
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            MessageSubmission,
            null,
            null,
            store.getTypeState( MessageSubmission ),
            ''
        );

    },

    messageSubmissionsSet: function ( args ) {
        this.didCommit( MessageSubmission, args );
    },

    error_setMessageSubimssions_stateMismatch: function () {
        // TODO: Fire error on all creates, to check and try again.
    },
});

JMAP.MessageSubmission = MessageSubmission;

}( JMAP ) );
