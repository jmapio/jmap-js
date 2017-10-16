// -------------------------------------------------------------------------- \\
// File: ContactGroup.js                                                      \\
// Module: ContactsModel                                                      \\
// Requires: API, Contact.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Record = O.Record,
    attr = Record.attr;

const ValidationError = O.ValidationError;
const REQUIRED = ValidationError.REQUIRED;

const ContactGroup = O.Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( REQUIRED,
                    O.loc( 'S_LABEL_REQUIRED' )
                );
            }
            return null;
        }
    }),

    contacts: Record.toMany({
        recordType: JMAP.Contact,
        key: 'contactIds',
        defaultValue: [],
        // Should really check that either:
        // (a) This is not a shared group and not a shared contact
        // (a) The user has write access to shared contacts AND
        //   (i)  The contact is shared
        //   (ii) The group is
        // (b) Is only adding/removing non-shared groups (need to compare
        //     new array to old array)
        // However, given the UI does not allow illegal changes to be made
        // (group is disabled in groups menu) and the server enforces this,
        // we don't bother checking it.
        willSet: function () {
            return true;
        }
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

    contains: function ( contact ) {
        return !!this.get( 'contactIndex' )[ contact.get( 'storeKey' ) ];
    }
});

JMAP.contacts.handle( ContactGroup, {
    precedence: 1, // After Contact
    fetch: 'getContactGroups',
    refresh: function ( _, state ) {
        this.callMethod( 'getContactGroupUpdates', {
            sinceState: state,
            fetchRecords: true
        });
    },
    commit: 'setContactGroups',
    // Response handlers
    contactGroups: function ( args, reqMethod, reqArgs ) {
        this.didFetch( ContactGroup, args,
            reqMethod === 'getContactGroups' && !reqArgs.ids );
    },
    contactGroupUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( ContactGroup, args, reqArgs );
    },
    error_getContactGroupUpdates_cannotCalculateChanges: function () {
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( ContactGroup );
    },
    contactGroupsSet: function ( args ) {
        this.didCommit( ContactGroup, args );
    }
});

JMAP.ContactGroup = ContactGroup;

}( JMAP ) );
