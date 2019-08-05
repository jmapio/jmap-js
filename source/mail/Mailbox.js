// -------------------------------------------------------------------------- \\
// File: Mailbox.js                                                           \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const loc = O.loc;
const i18n = O.i18n;
const Class = O.Class;
const RecordArray = O.RecordArray;
const LocalQuery = O.LocalQuery;
const Record = O.Record;
const attr = Record.attr;
const ValidationError = O.ValidationError;
const REQUIRED = ValidationError.REQUIRED;
const TOO_LONG = ValidationError.TOO_LONG;

const connection = JMAP.mail;
const makeSetRequest = JMAP.Connection.makeSetRequest;

// ---

const bySortOrderRoleOrName = function ( a, b ) {
    var aRole = a.role;
    var bRole = b.role;
    return (
        a.sortOrder - b.sortOrder
    ) || (
        aRole === 'inbox' ? -1 :
        bRole === 'inbox' ? 1 :
        aRole && !bRole ? -1 :
        bRole && !aRole ? 1 :
        i18n.compare( a.name, b.name )
    ) || (
        a.id < b.id ? -1 : 1
    );
};

const Mailbox = Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( REQUIRED,
                    loc( 'S_LABEL_REQUIRED' )
                );
            }
            if ( propValue.length > 256 ) {
                return new ValidationError( TOO_LONG,
                    loc( 'S_MAIL_ERROR_MAX_CHARS', 256 )
                );
            }
            return null;
        }
    }),

    parent: Record.toOne({
        // Type: Mailbox,
        key: 'parentId',
        defaultValue: null,
        willSet: function ( propValue, propKey, record ) {
            if ( propValue ) {
                record.set( 'accountId', propValue.get( 'accountId' ) );
            }
            return true;
        },
    }),

    role: attr( String, {
        defaultValue: null
    }),

    sortOrder: attr( Number, {
        defaultValue: 10
    }),

    // ---

    isSubscribed: attr( Boolean, {
        defaultValue: true,
    }),

    myRights: attr( Object, {
        defaultValue: {
            mayReadItems: true,
            mayAddItems: true,
            mayRemoveItems: true,
            maySetSeen: true,
            maySetKeywords: true,
            mayCreateChild: true,
            mayRename: true,
            mayDelete: true,
            maySubmit: true,
            mayAdmin: true,
        },
        noSync: true
    }),

    // ---

    totalEmails: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),
    unreadEmails: attr( Number, {
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
        var storeKey = this.get( 'storeKey' );
        var store = this.get( 'store' );
        var accountId = this.get( 'accountId' );
        return storeKey ?
            store.getAll( Mailbox,
                function ( data ) {
                    return data.accountId === accountId &&
                        data.parentId === storeKey;
                },
                bySortOrderRoleOrName
            ) :
            new RecordArray( store, Mailbox, [] );
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
        var sub = ( where === 'sub' );
        var parent = sub ? dest : dest.get( 'parent' );
        var accountId = dest.get( 'accountId' );
        var siblings = parent ?
                parent.get( 'subfolders' ) :
                this.get( 'store' ).getQuery( 'rootMailboxes-' + accountId,
                LocalQuery, {
                    Type: Mailbox,
                    where: function ( data ) {
                        return !data.parentId && data.accountId === accountId &&
                            data.role !== 'xnotes';
                    },
                    sort: bySortOrderRoleOrName,
                });
        var index = sub ? 0 :
                siblings.indexOf( dest ) + ( where === 'next' ? 1 : 0 );
        var prev = index ? siblings.getObjectAt( index - 1 ) : null;
        var next = siblings.getObjectAt( index );
        var prevSortOrder = prev ? prev.get( 'sortOrder' ) : 0;
        var nextSortOrder = next ? next.get( 'sortOrder' ) : ( index + 2 ) * 32;
        var i, p, l, folder;

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
        if ( this.get( 'myRights' ).mayDelete ) {
            // Destroy dependent records
            this.get( 'subfolders' ).forEach( function ( folder ) {
                folder.destroy();
            });
            Mailbox.parent.destroy.call( this );
        }
    },
});
Mailbox.__guid__ = 'Mailbox';
Mailbox.dataGroup = 'urn:ietf:params:jmap:mail';

Mailbox.prototype.parent.Type = Mailbox;

// ---

connection.ignoreCountsForMailboxIds = null;
connection.fetchIgnoredMailboxes = function () {
    var idToMailbox = connection.ignoreCountsForMailboxIds;
    if ( idToMailbox ) {
        Object.values( idToMailbox ).forEach( function ( mailbox ) {
            mailbox.fetch();
        });
    }
    connection.ignoreCountsForMailboxIds = null;
};

// ---

connection.handle( Mailbox, {

    precedence: 0,

    fetch: 'Mailbox',

    refresh: function ( accountId, ids, state ) {
        var get = 'Mailbox/get';
        if ( ids ) {
            this.callMethod( get, {
                accountId: accountId,
                ids: ids,
                properties: [
                    'totalEmails', 'unreadEmails',
                    'totalThreads', 'unreadThreads',
                ],
            });
        } else {
            var changes = 'Mailbox/changes';
            this.callMethod( changes, {
                accountId: accountId,
                sinceState: state,
            });
            var methodId = this.getPreviousMethodId();
            this.callMethod( get, {
                accountId: accountId,
                '#ids': {
                    resultOf: methodId,
                    name: changes,
                    path: '/created',
                },
            });
            this.callMethod( get, {
                accountId: accountId,
                '#ids': {
                    resultOf: methodId,
                    name: changes,
                    path: '/updated',
                },
                '#properties': {
                    resultOf: methodId,
                    name: changes,
                    path: '/updatedProperties',
                },
            });
        }
    },

    commit: function ( change ) {
        var args = makeSetRequest( change, true );
        args.onDestroyRemoveMessages = true;
        this.callMethod( 'Mailbox/set', args );
    },

    // ---

    'Mailbox/get': function ( args, _, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        const ignoreCounts = this.ignoreCountsForMailboxIds;
        if ( ignoreCounts && args.list ) {
            const accountId = args.accountId;
            args.list.forEach( function ( item ) {
                var mailbox = ignoreCounts[ accountId + '/' + item.id ];
                if ( mailbox ) {
                    item.totalThreads = mailbox.get( 'totalThreads' );
                    item.unreadEmails = mailbox.get( 'unreadEmails' );
                    item.totalEmails = mailbox.get( 'totalEmails' );
                    item.unreadThreads = mailbox.get( 'unreadThreads' );
                }
            });
        }
        this.didFetch( Mailbox, args, isAll );
    },

    'Mailbox/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Mailbox, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.fetchMoreChanges( args.accountId, Mailbox );
        }
    },

    'error_Mailbox/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, Mailbox );
    },

    'Mailbox/set': function ( args ) {
        this.didCommit( Mailbox, args );
    },
});
Mailbox.bySortOrderRoleOrName = bySortOrderRoleOrName;

// --- Export

JMAP.Mailbox = Mailbox;

}( JMAP ) );
