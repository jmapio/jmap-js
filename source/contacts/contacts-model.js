// -------------------------------------------------------------------------- \\
// File: contacts-model.js                                                    \\
// Module: ContactsModel                                                      \\
// Requires: API, Contact.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Obj = O.Object;
const NestedStore = O.NestedStore;
const StoreUndoManager = O.StoreUndoManager;

const Contact = JMAP.Contact;
const store = JMAP.store;
const contacts = JMAP.contacts;

// ---

const contactsIndex = new Obj({
    index: null,
    clearIndex: function () {
        this.index = null;
    },
    buildIndex: function () {
        var index = this.index = {};
        var storeKeys = store.findAll( Contact );
        var i, l, contact, emails, ll;
        for ( i = 0, l = storeKeys.length; i < l; i += 1 ) {
            contact = store.materialiseRecord( storeKeys[i] );
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
    },
});
store.on( Contact, contactsIndex, 'clearIndex' );

// ---

const editStore = new NestedStore( store );

Object.assign( contacts, {
    editStore: editStore,

    undoManager: new StoreUndoManager({
        store: editStore,
        maxUndoCount: 10,
    }),

    getContactFromEmail: function ( email ) {
        var index = contactsIndex.getIndex();
        return index[ email.toLowerCase() ] || null;
    },
});

}( JMAP ) );
