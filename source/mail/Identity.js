// -------------------------------------------------------------------------- \\
// File: Identity.js                                                          \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

var Record = O.Record;
var attr = Record.attr;

// ---

var Identity = O.Class({

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
    fetch: 'getIdentities',
    commit: 'setIdentities',
    // Response handlers
    identities: function ( args ) {
        this.didFetch( Identity, args, true );
    },
    identitiesSet: function ( args ) {
        this.didCommit( Identity, args );
    }
});

JMAP.Identity = Identity;

}( JMAP ) );
