// -------------------------------------------------------------------------- \\
// File: contacts-model.js                                                    \\
// Module: ContactsModel                                                      \\
// Requires: API, Contact.js                                                  \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const loc = O.loc;
const mixin = O.mixin;
const READY = O.Status.READY;
const Obj = O.Object;
const NestedStore = O.NestedStore;
const StoreUndoManager = O.StoreUndoManager;

const Contact = JMAP.Contact;
const ContactGroup = JMAP.ContactGroup;
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
        var i, l, storeKey, emails, ll;
        for ( i = 0, l = storeKeys.length; i < l; i += 1 ) {
            storeKey = storeKeys[i];
            emails = store.getData( storeKey ).emails;
            ll = emails ? emails.length : 0;
            while ( ll-- ) {
                index[ emails[ll].value.toLowerCase() ] = storeKey;
            }
        }
        return index;
    },
    getIndex: function () {
        return this.index || this.buildIndex();
    },
});
store.on( Contact, contactsIndex, 'clearIndex' );

// --- VIPs

const UNCACHED = 0;
const REVALIDATE = 1;
const CACHED = 2;

const vips = new Obj({
    _groupCacheState: UNCACHED,
    _group: null,
    _vipSKs: null,

    recalculate: function () {
        this._groupCacheState = REVALIDATE;
        var group = this.getGroup( store, false );
        var newStoreKeys = group ? group.get( 'contactIndex' ) : {};
        var oldStoreKeys = this._vipSKs || {};
        var isChanged = false;
        var storeKey;
        for ( storeKey in oldStoreKeys ) {
            if ( !( storeKey in newStoreKeys ) ) {
                isChanged = true;
                store.getRecordFromStoreKey( storeKey )
                    .computedPropertyDidChange( 'isVIP' );
            }
        }
        for ( storeKey in newStoreKeys ) {
            if ( !( storeKey in oldStoreKeys ) ) {
                isChanged = true;
                store.getRecordFromStoreKey( storeKey )
                    .computedPropertyDidChange( 'isVIP' );
            }
        }
        this._vipSKs = newStoreKeys;
        if ( isChanged ) {
            this.fire( 'change' );
        }
    },

    // ---

    getGroup: function ( storeForContact, createIfNotFound ) {
        var group = this._group;
        var groupCacheState = this._groupCacheState;
        if ( groupCacheState === CACHED && ( group || !createIfNotFound ) ) {
            // Nothing to do
        } else if ( groupCacheState === REVALIDATE &&
                group && group.is( READY ) ) {
            this._groupCacheState = CACHED;
        } else {
            group = store.getOne( ContactGroup, data => data.uid === 'vips' );
            if ( !group && createIfNotFound ) {
                group = new ContactGroup( store )
                    .set( 'name', loc( 'VIPS' ) )
                    .set( 'uid', 'vips' )
                    .saveToStore();
            }
            this._group = group;
            this._groupCacheState = CACHED;
        }
        return group && group.getDoppelganger( storeForContact );
    },

    add: function ( contact ) {
        var group = this.getGroup( contact.get( 'store' ), true );
        group.addContact( contact );
        return this;
    },

    remove: function ( contact ) {
        var group = this.getGroup( contact.get( 'store' ), false );
        if ( group ) {
            group.removeContact( contact );
        }
        return this;
    },

    containsStoreKey: function ( store, storeKey ) {
        var group = this.getGroup( store, false );
        if ( group ) {
            return group.get( 'contactIndex' )[ storeKey ] || false;
        }
        return false;
    },

    contains: function ( contact ) {
        return this.containsStoreKey(
            contact.get( 'store' ),
            contact.get( 'storeKey' )
        );
    },
});
store.on( ContactGroup, vips, 'recalculate' );

mixin( Contact.prototype, {
    isVIP: function ( isVIP ) {
        if ( !this.get( 'storeKey' ) ) {
            return false;
        }
        if ( isVIP !== undefined ) {
            if ( isVIP ) {
                vips.add( this );
            } else {
                vips.remove( this );
            }
        } else {
            isVIP = vips.contains( this );
        }
        return isVIP;
    }.property(),
});

// ---

const editStore = new NestedStore( store );

Object.assign( contacts, {
    editStore: editStore,

    undoManager: new StoreUndoManager({
        store: editStore,
        maxUndoCount: 10,
    }),

    vips: vips,

    getContactFromEmail: function ( email ) {
        var index = contactsIndex.getIndex();
        var storeKey = index[ email.toLowerCase() ];
        return storeKey ? store.getRecordFromStoreKey( storeKey ) : null;
    },
});

}( JMAP ) );
