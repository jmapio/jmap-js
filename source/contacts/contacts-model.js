// -------------------------------------------------------------------------- \\
// File: contacts-model.js                                                    \\
// Module: ContactsModel                                                      \\
// Requires: API, Contact.js                                                  \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

var contactsIndex = new O.Object({
    index: null,
    clearIndex: function () {
        this.index = null;
    },
    buildIndex: function () {
        var index = this.index = {},
            Contact = JMAP.Contact,
            store = JMAP.store,
            storeKeys = store.findAll( Contact ),
            i, l, contact, emails, ll;
        for ( i = 0, l = storeKeys.length; i < l; i += 1 ) {
            contact = store.materialiseRecord( storeKeys[i], Contact );
            emails = contact.get( 'emails' );
            ll = emails.length;
            while ( ll-- ) {
                index[ emails[ll].value.toLowerCase() ] = contact;
            }
        }
        return index;
    },
    getIndex: function () {
        return this.index || this.buildIndex();
    }
});
JMAP.store.on( JMAP.Contact, contactsIndex, 'clearIndex' );

var editStore = new O.NestedStore( JMAP.store );

Object.assign( JMAP.contacts, {
    editStore: editStore,

    undoManager: new O.StoreUndoManager({
        store: editStore,
        maxUndoCount: 10
    }),

    getContactFromEmail: function ( email ) {
        var index = contactsIndex.getIndex();
        return index[ email.toLowerCase() ] || null;
    }
});

}( JMAP ) );
