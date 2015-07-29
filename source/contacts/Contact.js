// -------------------------------------------------------------------------- \\
// File: Contact.js                                                           \\
// Module: ContactsModel                                                      \\
// Requires: API, AmbiguousDate.js                                            \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP ) {

var Record = O.Record,
    attr = Record.attr;

var Contact = O.Class({

    Extends: Record,

    isFlagged: attr( Boolean, {
        defaultValue: false
    }),

    avatar: attr( Object, {
        defaultValue: null
    }),

    importance: attr( Number, {
        defaultValue: 0
    }),

    prefix: attr( String, {
        defaultValue: ''
    }),
    firstName: attr( String, {
        defaultValue: ''
    }),
    lastName: attr( String, {
        defaultValue: ''
    }),
    suffix: attr( String, {
        defaultValue: ''
    }),

    nickname: attr( String, {
        defaultValue: ''
    }),

    birthday: attr( JMAP.AmbiguousDate, {
        defaultValue: new JMAP.AmbiguousDate( 0, 0, 0 )
    }),
    anniversary: attr( JMAP.AmbiguousDate, {
        defaultValue: new JMAP.AmbiguousDate( 0, 0, 0 )
    }),

    company: attr( String, {
        defaultValue: ''
    }),
    department: attr( String, {
        defaultValue: ''
    }),
    jobTitle: attr( String, {
        defaultValue: ''
    }),

    emails: attr( Array, {
        defaultValue: []
    }),
    phones: attr( Array, {
        defaultValue: []
    }),
    online: attr( Array, {
        defaultValue: []
    }),

    addresses: attr( Array, {
        defaultValue: []
    }),

    notes: attr( String, {
        defaultValue: ''
    }),

    // ---

    groups: function () {
        var contact = this;
        return contact
            .get( 'store' )
            .getAll( JMAP.ContactGroup, null, O.sortByProperties([ 'name' ]) )
            .filter( function ( group ) {
                return group.contains( contact );
           });
    }.property().nocache(),

    // ---

    // Destroy dependent records.
    destroy: function () {
        this.get( 'groups' ).forEach( function ( group ) {
            group.get( 'contacts' ).remove( this );
        }, this );
        Contact.parent.destroy.call( this );
    },

    // ---

    name: function () {
        var name = ( this.get( 'firstName' ) + ' ' +
            this.get( 'lastName' ) ).trim();
        if ( !name ) {
            name = this.get( 'company' );
        }
        return name;
    }.property( 'firstName', 'lastName', 'company' ),

    emailName: function () {
        var name = this.get( 'name' ).replace( /["\\]/g, '' );
        if ( /[,;@]/.test( name ) ) {
            name = '"' + name + '"';
        }
        return name;
    }.property( 'name' ),

    defaultEmailIndex: function () {
        var emails = this.get( 'emails' ),
            i, l;
        for ( i = 0, l = emails.length; i < l; i += 1 ) {
            if ( emails[i].isDefault ) {
                return i;
            }
        }
        return 0;
    }.property( 'emails' ),

    defaultEmail: function () {
        var email = this.get( 'emails' )[ this.get( 'defaultEmailIndex' ) ];
        return email ? email.value : '';
    }.property( 'emails' ),

    defaultNameAndEmail: function () {
        var name = this.get( 'emailName' ),
            email = this.get( 'defaultEmail' );
        return email ? name ? name + ' <' + email + '>' : email : '';
    }.property( 'emailName', 'defaultEmail' )
});

JMAP.contacts.handle( Contact, {
    precedence: 0, // Before ContactGroup
    fetch: 'getContacts',
    refresh: function ( _, state ) {
        this.callMethod( 'getContactUpdates', {
            sinceState: state,
            maxChanges: 100,
            fetchRecords: true
        });
    },
    commit: 'setContacts',
    // Response handlers
    contacts: function ( args, reqMethod, reqArgs ) {
        this.didFetch( Contact, args,
            reqMethod === 'getContacts' && !reqArgs.ids );
    },
    contactUpdates: function ( args ) {
        this.didFetchUpdates( Contact, args );
        if ( args.hasMoreUpdates ) {
            this.get( 'store' ).fetchAll( Contact, true );
        }
    },
    error_getContactUpdates_cannotCalculateChanges: function () {
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( Contact );
    },
    contactsSet: function ( args ) {
        this.didCommit( Contact, args );
    }
});

JMAP.Contact = Contact;

}( JMAP ) );
