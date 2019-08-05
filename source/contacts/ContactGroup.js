// -------------------------------------------------------------------------- \\
// File: ContactGroup.js                                                      \\
// Module: ContactsModel                                                      \\
// Requires: API, Contact.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const loc = O.loc;
const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const ValidationError = O.ValidationError;
const REQUIRED = ValidationError.REQUIRED;

const auth = JMAP.auth;
const contacts = JMAP.contacts;
const Contact = JMAP.Contact;

// ---

const ContactGroup = Class({

    Extends: Record,

    isEditable: function () {
        var accountId = this.get( 'accountId' );
        return !accountId ||
            !auth.get( 'accounts' )[ accountId ].isReadOnly;
    }.property( 'accountId' ),

    uid: attr( String ),

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( REQUIRED,
                    loc( 'S_LABEL_REQUIRED' )
                );
            }
            return null;
        },
    }),

    contacts: Record.toMany({
        recordType: Contact,
        key: 'contactIds',
        defaultValue: [],
        willSet: function () {
            return true;
        },
    }),

    contactIndex: function () {
        var storeKeys = this.contacts.getRaw( this, 'contacts' );
        var index = {};
        var i, l;
        for ( i = 0, l = storeKeys.length; i < l; i += 1 ) {
            index[ storeKeys[i] ] = true;
        }
        return index;
    }.property( 'contacts' ),

    containsStoreKey: function ( storeKey ) {
        return !!this.get( 'contactIndex' )[ storeKey ];
    },

    contains: function ( contact ) {
        return this.containsStoreKey( contact.get( 'storeKey' ) );
    },

    addContact: function ( contact ) {
        this.get( 'contacts' ).add( contact );
        return this;
    },

    removeContact: function ( contact ) {
        this.get( 'contacts' ).remove( contact );
        return this;
    },
});
ContactGroup.__guid__ = 'ContactGroup';
ContactGroup.dataGroup = 'urn:ietf:params:jmap:contacts';

// ---

contacts.handle( ContactGroup, {

    precedence: 1, // After Contact

    fetch: 'ContactGroup',
    refresh: 'ContactGroup',
    commit: 'ContactGroup',

    // ---

    'ContactGroup/get': function ( args, _, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( ContactGroup, args, isAll );
    },

    'ContactGroup/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( ContactGroup, args, hasDataForChanged );
    },

    'error_ContactGroup/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, ContactGroup );
    },

    'ContactGroup/set': function ( args ) {
        this.didCommit( ContactGroup, args );
    },
});

// --- Export

JMAP.ContactGroup = ContactGroup;

}( JMAP ) );
