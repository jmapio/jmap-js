// -------------------------------------------------------------------------- \\
// File: Identity.js                                                          \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Record = O.Record;
const attr = Record.attr;

// ---

const Identity = O.Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
    }),

    email: attr( String ),

    replyTo: attr( String, {
        defaultValue: '',
    }),

    bcc: attr( String, {
        defaultValue: '',
    }),

    textSignature: attr( String, {
        key: 'textSignature',
        defaultValue: ''
    }),

    htmlSignature: attr( String, {
        key: 'htmlSignature',
        defaultValue: ''
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

JMAP.mail.handle( Identity, {

    precedence: 2,

    fetch: function ( ids ) {
        this.callMethod( 'getIdentities', {
            ids: ids || null,
        });
    },

    refresh: function ( ids, state ) {
        if ( ids ) {
            this.callMethod( 'getIdentities', {
                ids: ids,
            });
        } else {
            this.callMethod( 'getIdentityUpdates', {
                sinceState: state,
                maxChanges: 100,
            });
            this.callMethod( 'getIdentities', {
                '#ids': {
                    resultOf: this.getPreviousMethodId(),
                    path: '/changed',
                },
            });
        }
    },

    commit: 'setIdentities',

    // ---

    identities: function ( args, reqMethod, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( Identity, args, isAll );
    },

    identityUpdates: function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Identity, args, hasDataForChanged );
        if ( args.hasMoreUpdates ) {
            this.get( 'store' ).fetchAll( Identity, true );
        }
    },

    error_getIdentityUpdates_cannotCalculateChanges: function () {
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( Identity );
    },

    identitiesSet: function ( args ) {
        this.didCommit( Identity, args );
    },
});

JMAP.Identity = Identity;

}( JMAP ) );
