// -------------------------------------------------------------------------- \\
// File: MessageSubmission.js                                                 \\
// Module: MailModel                                                          \\
// Requires: API, Mailbox.js, Message.js, Thread.js, Identity.js              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;

const mail = JMAP.mail;
const Identity = JMAP.Identity;
const Message = JMAP.Message;
const Thread = JMAP.Thread;
const Mailbox = JMAP.Mailbox;
const makeSetRequest = JMAP.Connection.makeSetRequest;

// ---

const MessageSubmission = Class({

    Extends: Record,

    identity: Record.toOne({
        Type: Identity,
        key: 'identityId',
    }),

    message: Record.toOne({
        Type: Message,
        key: 'emailId',
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
        toJSON: Date.toUTCJSON,
        noSync: true,
    }),

    undoStatus: attr( String ),

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
MessageSubmission.__guid__ = 'EmailSubmission';
MessageSubmission.dataGroup = 'urn:ietf:params:jmap:mail';

MessageSubmission.makeEnvelope = function ( message, extraRecipients ) {
    var sender = message.get( 'sender' );
    var mailFrom = {
        email: sender && sender[0] ?
            sender[0].email :
            message.get( 'fromEmail' ),
        parameters: null,
    };
    var rcptTo = [];
    var seen = {};
    var addAddress = function ( address ) {
        var email = address.email;
        if ( email && !seen[ email ] ) {
            seen[ email ] = true;
            rcptTo.push({ email: email, parameters: null });
        }
    };
    [ 'to', 'cc', 'bcc' ].forEach( function ( header ) {
        var addresses = message.get( header );
        if ( addresses ) {
            addresses.forEach( addAddress );
        }
    });
    if ( extraRecipients ) {
        extraRecipients.forEach( addAddress );
    }
    return {
        mailFrom: mailFrom,
        rcptTo: rcptTo,
    };
};


mail.handle( MessageSubmission, {

    precedence: 3,

    fetch: function ( accountId, ids ) {
        this.callMethod( 'EmailSubmission/get', {
            accountId: accountId,
            ids: ids || [],
        });
    },

    refresh: 'EmailSubmission',

    commit: function ( change ) {
        var store = this.get( 'store' );
        var args = makeSetRequest( change, false );

        // TODO: Prevent double sending if dodgy connection
        // if ( Object.keys( args.create ).length ) {
        //     args.ifInState = change.state;
        // }

        var onSuccessUpdateEmail = {};
        var onSuccessDestroyEmail = [];
        var create = args.create;
        var update = args.update;
        var accountId = change.accountId;
        var id, submission;

        // On create move from drafts, remove $draft keyword
        for ( id in create ) {
            submission = create[ id ];
            if ( submission.onSuccess === null ) {
                args.onSuccessDestroyEmail = onSuccessDestroyEmail;
                onSuccessDestroyEmail.push( '#' + id );
            } else if ( submission.onSuccess ) {
                args.onSuccessUpdateEmail = onSuccessUpdateEmail;
                onSuccessUpdateEmail[ '#' + id ] = submission.onSuccess;
            }
            delete submission.onSuccess;
        }

        // On unsend, move back to drafts, set $draft keyword.
        for ( id in update ) {
            submission = update[ id ];
            if ( submission.onSuccess === null ) {
                args.onSuccessDestroyEmail = onSuccessDestroyEmail;
                onSuccessDestroyEmail.push( id );
            } else if ( submission.onSuccess ) {
                args.onSuccessUpdateEmail = onSuccessUpdateEmail;
                onSuccessUpdateEmail[ id ] = submission.onSuccess;
            }
            delete submission.onSuccess;
        }

        this.callMethod( 'EmailSubmission/set', args );
        if ( args.onSuccessUpdateEmail || args.onSuccessDestroyEmail ) {
            this.fetchAllRecords(
                accountId, Message, store.getTypeState( accountId, Message ) );
            this.fetchAllRecords(
                accountId, Mailbox, store.getTypeState( accountId, Mailbox ) );
        }
    },

    // ---

    'EmailSubmission/get': function ( args ) {
        this.didFetch( MessageSubmission, args, false );
    },

    'EmailSubmission/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( MessageSubmission, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.fetchMoreChanges( args.accountId, MessageSubmission );
        }
    },

    'error_EmailSubmission/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var store = this.get( 'store' );
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Unload if possible, otherwise mark
        // obsolete.
        store.getAll( MessageSubmission ).forEach( function ( submission ) {
            if ( submission.get( 'accountId' ) === accountId ) {
                if ( !store.unloadRecord( submission.get( 'storeKey' ) ) ) {
                    submission.setObsolete();
                }
            }
        });
        // Tell the store we're now in the new state.
        store.sourceDidFetchUpdates(
            accountId,
            MessageSubmission,
            null,
            null,
            store.getTypeState( accountId, MessageSubmission ),
            ''
        );

    },

    'EmailSubmission/set': function ( args ) {
        this.didCommit( MessageSubmission, args );
    },

    'error_EmailSubmission/set_stateMismatch': function () {
        // TODO
        // store.sourceDidNotCreate( storeKeys, false,
        //     storeKeys.map( function () { return { type: 'stateMismatch' }
        // }) );
        // 1. Fetch EmailSubmission/changes (inc. fetch records)
        // 2. Check if any of these are sending the same message
        // 3. If not retry. If yes, destroy?
    },
});

// --- Export

JMAP.MessageSubmission = MessageSubmission;

}( JMAP ) );
