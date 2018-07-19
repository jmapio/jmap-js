// -------------------------------------------------------------------------- \\
// File: Identity.js                                                          \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;

// ---

const Identity = Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
    }),

    email: attr( String ),

    replyTo: attr( Array, {
        defaultValue: null,
    }),

    bcc: attr( Array, {
        defaultValue: null,
    }),

    textSignature: attr( String, {
        defaultValue: '',
    }),

    htmlSignature: attr( String, {
        defaultValue: '',
    }),

    mayDelete: attr( Boolean, {
        defaultValue: true
    }),

    // ---

    nameAndEmail: function () {
        var name = this.get( 'name' ).replace( /["\\]/g, '' );
        var email = this.get( 'email' );
        if ( name ) {
            if ( /[,;<>@()]/.test( name ) ) {
                name = '"' + name + '"';
            }
            return name + ' <' + email + '>';
        }
        return email;
    }.property( 'name', 'email' ),
});
Identity.__guid__ = 'Identity';
Identity.dataGroup = 'urn:ietf:params:jmap:mail';

JMAP.mail.handle( Identity, {

    precedence: 2,

    fetch: 'Identity',
    refresh: 'Identity',
    commit: 'Identity',

    // ---

    'Identity/get': function ( args, reqMethod, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( Identity, args, isAll );
    },

    'Identity/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Identity, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.get( 'store' ).fetchAll( args.accountId, Identity, true );
        }
    },

    'error_Identity/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, Identity );
    },

    'Identity/set': function ( args ) {
        this.didCommit( Identity, args );
    },
});

// --- Export

JMAP.Identity = Identity;

}( JMAP ) );
