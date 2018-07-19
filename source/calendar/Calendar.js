// -------------------------------------------------------------------------- \\
// File: Calendar.js                                                          \\
// Module: CalendarModel                                                      \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const loc = O.loc;
const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const ValidationError = O.ValidationError;
const DESTROYED = O.Status.DESTROYED;

// ---

const Calendar = Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new ValidationError( ValidationError.REQUIRED,
                    loc( 'S_LABEL_REQUIRED' )
                );
            }
            return null;
        }
    }),

    color: attr( String, {
        defaultValue: '#3a429c'
    }),

    sortOrder: attr( Number, {
        defaultValue: 0
    }),

    isVisible: attr( Boolean, {
        defaultValue: true
    }),

    cascadeChange: function ( _, key, oldValue, newValue ) {
        var store = this.get( 'store' );
        var calendarSK = this.get( 'storeKey' );
        var property = 'calendar-' + key;
        if ( !store.isNested ) {
            store.getAll( JMAP.CalendarEvent, function ( data ) {
                return data.calendarId === calendarSK;
            }).forEach( function ( event ) {
                if ( event.get( 'recurrenceRule' ) ||
                        event.get( 'recurrenceOverrides' ) ) {
                    var cache = event._ocache;
                    var id;
                    for ( id in cache ) {
                        cache[ id ].propertyDidChange(
                            property, oldValue, newValue );
                    }
                } else {
                    event.propertyDidChange( property, oldValue, newValue );
                }
            });
        }
    }.observes( 'name', 'color' ),

    calendarWasDestroyed: function () {
        if ( this.get( 'status' ) === DESTROYED ) {
            var store = this.get( 'store' );
            var calendarSK = this.get( 'storeKey' );
            if ( !store.isNested ) {
                store.findAll( JMAP.CalendarEvent, function ( data ) {
                    return data.calendarId === calendarSK;
                }).forEach( function ( storeKey ) {
                    store.setStatus( storeKey, DESTROYED )
                         .unloadRecord( storeKey );
                });
            }
        }
    }.observes( 'status' ),

    // ---

    mayReadFreeBusy: attr( Boolean, {
        defaultValue: true
    }),
    mayReadItems: attr( Boolean, {
        defaultValue: true
    }),
    mayAddItems: attr( Boolean, {
        defaultValue: true
    }),
    mayModifyItems: attr( Boolean, {
        defaultValue: true
    }),
    mayRemoveItems: attr( Boolean, {
        defaultValue: true
    }),

    mayRename: attr( Boolean, {
        defaultValue: true
    }),
    mayDelete: attr( Boolean, {
        defaultValue: true
    }),

    mayWrite: function ( mayWrite ) {
        if ( mayWrite !== undefined ) {
            this.set( 'mayAddItems', mayWrite )
                .set( 'mayModifyItems', mayWrite )
                .set( 'mayRemoveItems', mayWrite );
        } else {
            mayWrite = this.get( 'mayAddItems' ) &&
                this.get( 'mayModifyItems' ) &&
                this.get( 'mayRemoveItems' );
        }
        return mayWrite;
    }.property( 'mayAddItems', 'mayModifyItems', 'mayRemoveItems' ),
});
Calendar.__guid__ = 'Calendar';
Calendar.dataGroup = 'urn:ietf:params:jmap:calendars';

JMAP.calendar.handle( Calendar, {

    precedence: 1,

    fetch: 'Calendar',
    refresh: 'Calendar',
    commit: 'Calendar',

    // ---

    'Calendar/get': function ( args, reqMethod, reqArgs ) {
        const isAll = ( reqArgs.ids === null );
        this.didFetch( Calendar, args, isAll );
    },

    'Calendar/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( Calendar, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.get( 'store' ).fetchAll( args.accountId, Calendar, true );
        }
    },

    'error_Calendar/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( accountId, Calendar );
    },

    'Calendar/set': function ( args ) {
        this.didCommit( Calendar, args );
    },
});

// --- Export

JMAP.Calendar = Calendar;

}( JMAP ) );
