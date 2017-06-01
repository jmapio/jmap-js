// -------------------------------------------------------------------------- \\
// File: Mailbox.js                                                           \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

var Record = O.Record;
var attr = Record.attr;

var ValidationError = O.ValidationError;
var REQUIRED        = ValidationError.REQUIRED;
var TOO_LONG        = ValidationError.TOO_LONG;

var Mailbox = O.Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( REQUIRED,
                    O.loc( 'S_LABEL_REQUIRED' )
                );
            }
            if ( propValue.length > 256 ) {
                return new ValidationError( TOO_LONG,
                    O.loc( 'S_MAIL_ERROR_MAX_CHARS', 256 )
                );
            }
            return null;
        }
    }),

    parent: Record.toOne({
        Type: Mailbox,
        key: 'parentId',
        defaultValue: null
    }),

    role: attr( String, {
        defaultValue: null
    }),

    sortOrder: attr( Number, {
        defaultValue: 10
    }),

    // ---

    mustBeOnlyMailbox: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayReadItems: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayAddItems: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayRemoveItems: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayCreateChild: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayRename: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),
    mayDelete: attr( Boolean, {
        defaultValue: true,
        noSync: true
    }),

    // ---

    totalMessages: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),
    unreadMessages: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),
    totalThreads: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),
    unreadThreads: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),

    // ---

    displayName: function () {
        return this.get( 'name' );
    }.property( 'name' ),

    subfolders: function () {
        var storeKey = this.get( 'storeKey' ),
            store = this.get( 'store' );
        return storeKey ?
            store.getAll( Mailbox,
                function ( data ) {
                    return data.parentId === storeKey;
                },
                O.sortByProperties([ 'sortOrder', 'name' ])
            ) :
            new O.RecordArray( store, Mailbox, [] );
    }.property().nocache(),

    depth: function () {
        var parent = this.get( 'parent' );
        return parent ? parent.get( 'depth' ) + 1 : 0;
    }.property( 'parent' ),

    depthDidChange: function ( _, __, oldDepth ) {
        if ( oldDepth !== this.get( 'depth' ) ) {
            this.get( 'subfolders' ).forEach( function ( mailbox ) {
                mailbox.computedPropertyDidChange( 'depth' );
            });
        }
    }.observes( 'depth' ),

    // ---

    moveTo: function ( dest, where ) {
        var sub = ( where === 'sub' ),
            parent = sub ? dest : dest.get( 'parent' ),
            siblings = parent ?
                parent.get( 'subfolders' ) :
                this.get( 'store' ).getQuery( 'rootMailboxes', O.LiveQuery, {
                    Type: Mailbox,
                    filter: function ( data ) {
                        return !data.parentId;
                    },
                    sort: [ 'sortOrder', 'name' ]
                }),
            index = sub ? 0 :
                siblings.indexOf( dest ) + ( where === 'next' ? 1 : 0 ),
            prev = index ? siblings.getObjectAt( index - 1 ) : null,
            next = siblings.getObjectAt( index ),
            prevSortOrder = prev ? prev.get( 'sortOrder' ) : 0,
            nextSortOrder = next ? next.get( 'sortOrder' ) : ( index + 2 ) * 32,
            i, p, l, folder;

        if ( nextSortOrder - prevSortOrder < 2 ) {
            for ( i = 0, p = 32, l = siblings.get( 'length' );
                    i < l; i += 1, p += 32 ) {
                folder = siblings.getObjectAt( i );
                if ( folder !== this ) {
                    folder.set( 'sortOrder', p );
                    if ( folder === prev ) {
                        p += 32;
                    }
                }
            }
            if ( prev ) { prevSortOrder = prev.get( 'sortOrder' ); }
            if ( next ) { nextSortOrder = next.get( 'sortOrder' ); }
        }
        this.set( 'parent', parent || null )
            .set( 'sortOrder', ( nextSortOrder + prevSortOrder ) >> 1 );
    },

    // ---

    destroy: function () {
        // Check ACL
        if ( this.get( 'mayDelete' ) ) {
            // Destroy dependent records
            this.get( 'subfolders' ).forEach( function ( folder ) {
                folder.destroy();
            });
            Mailbox.parent.destroy.call( this );
        }
    }
});

Mailbox.prototype.parent.Type = Mailbox;

JMAP.mail.handle( Mailbox, {
    precedence: 0,
    fetch: function ( ids ) {
        this.callMethod( 'getMailboxes', {
            ids: ids || null,
            properties: null
        });
    },
    refresh: function ( ids, state ) {
        if ( ids ) {
            this.callMethod( 'getMailboxes', {
                ids: ids,
                properties: [
                    'totalMessages', 'unreadMessages',
                    'totalThreads', 'unreadThreads'
                ]
            });
        } else {
            this.callMethod( 'getMailboxUpdates', {
                sinceState: state,
                fetchRecords: true,
                fetchRecordProperties: null
            });
        }
    },
    commit: 'setMailboxes',

    // ---

    mailboxes: function ( args, reqMethod, reqArgs ) {
        this.didFetch( Mailbox, args,
            reqMethod === 'getMailboxes' && !reqArgs.ids );
    },

    mailboxUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( Mailbox, args, reqArgs );
    },
    error_getMailboxUpdates_cannotCalculateChanges: function () {
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( Mailbox );
    },

    mailboxesSet: function ( args ) {
        this.didCommit( Mailbox, args );
    }
});

JMAP.Mailbox = Mailbox;

}( JMAP ) );
