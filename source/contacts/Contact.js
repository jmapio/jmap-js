// -------------------------------------------------------------------------- \\
// File: Contact.js                                                           \\
// Module: ContactsModel                                                      \\
// Requires: API, AmbiguousDate.js                                            \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const sortByProperties = O.sortByProperties;

const auth = JMAP.auth;
const contacts = JMAP.contacts;
const AmbiguousDate = JMAP.AmbiguousDate;

// ---

const Contact = Class({

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

    birthday: attr( AmbiguousDate, {
        defaultValue: '0000-00-00'
    }),
    anniversary: attr( AmbiguousDate, {
        defaultValue: '0000-00-00'
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

    isEditable: function () {
        var accountId = this.get( 'accountId' );
        return !accountId ||
            !auth.get( 'accounts' )[ accountId ].isReadOnly;
    }.property( 'accountId' ),

    // ---

    groups: function () {
        var contact = this;
        return contact
            .get( 'store' )
            .getAll( JMAP.ContactGroup, null, sortByProperties([ 'name' ]) )
            .filter( function ( group ) {
                return group.contains( contact );
           });
    }.property(),

    groupsDidChange: function () {
        this.computedPropertyDidChange( 'groups' );
    },

    // ---

    init: function () {
        Contact.parent.init.apply( this, arguments );
        this.get( 'store' ).on( JMAP.ContactGroup, this, 'groupsDidChange' );
    },

    storeWillUnload: function () {
        this.get( 'store' ).off( JMAP.ContactGroup, this, 'groupsDidChange' );
        Contact.parent.storeWillUnload.call( this );
    },

    // Destroy dependent records.
    destroy: function () {
        this.get( 'groups' ).forEach( function ( group ) {
            group.removeContact( this );
        }, this );
        Contact.parent.destroy.call( this );
    },

    // ---

    name: function ( name ) {
        if ( name !== undefined ) {
            name = name ? name.trim() : '';
            var space = name.lastIndexOf( ' ' );
            this.set( 'firstName', space > -1 ?
                    name.slice( 0, space ) : name )
                .set( 'lastName', space > -1 ?
                    name.slice( space + 1 ) : '' );
        } else {
            name = (
                this.get( 'firstName' ) + ' ' + this.get( 'lastName' )
            ).trim() || this.get( 'company' );
        }
        return name;
    }.property( 'firstName', 'lastName', 'company' ),

    emailName: function () {
        var name = this.get( 'name' ).replace( /["\\]/g, '' );
        if ( /[,;<>@()]/.test( name ) ) {
            name = '"' + name + '"';
        }
        return name;
    }.property( 'name' ),

    defaultEmailIndex: function () {
        var emails = this.get( 'emails' );
        var i, l;
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
        var name = this.get( 'emailName' );
        var email = this.get( 'defaultEmail' );
        return email ? name ? name + ' <' + email + '>' : email : '';
    }.property( 'emailName', 'defaultEmail' )
});
Contact.__guid__ = 'Contact';
Contact.dataGroup = 'urn:ietf:params:jmap:contacts';

// ---

contacts.handle( Contact, {

    precedence: 0, // Before ContactGroup

    fetch: 'Contact',
    refresh: 'Contact',
    commit: 'Contact',

    // ---

    'Contact/get': function ( args, reqMethod, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( Contact, args, isAll );
    },

    'Contact/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Contact, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.get( 'store' ).fetchAll( args.accountId, Contact, true );
        }
    },

    'Contact/copy': function ( args ) {
        this.didCopy( Contact, args );
    },

    'error_Contact/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, Contact );
    },

    'Contact/set': function ( args ) {
        this.didCommit( Contact, args );
    },
});

// --- Export

JMAP.Contact = Contact;

}( JMAP ) );
