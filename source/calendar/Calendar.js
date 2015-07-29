// -------------------------------------------------------------------------- \\
// File: Calendar.js                                                          \\
// Module: CalendarModel                                                      \\
// Requires: API                                                              \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP, undefined ) {

var Record = O.Record,
    attr = Record.attr;

var Calendar = O.Class({

    Extends: Record,

    name: attr( String, {
        defaultValue: '',
        validate: function ( propValue/*, propKey, record*/ ) {
            if ( !propValue ) {
                return new O.ValidationError( O.ValidationError.REQUIRED,
                    O.loc( 'S_LABEL_REQUIRED' )
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

    cascadeChange: function ( _, key, oldValue, newValue ) {
        var store = this.get( 'store' ),
            calendarId = this.get( 'id' ),
            property = 'calendar-' + key;
        if ( !store.isNested ) {
            store.getAll( JMAP.CalendarEvent, function ( data ) {
                return data.calendarId === calendarId;
            }).forEach( function ( event ) {
                if ( event.get( 'recurrence' ) ) {
                    var cache = event._ocache,
                        id;
                    for ( id in cache ) {
                        cache[ id ].propertyDidChange(
                            property, oldValue, newValue );
                    }
                } else {
                    event.propertyDidChange( property, oldValue, newValue );
                }
            });
        }
    }.observes( 'color', 'name' ),

    calendarWasDestroyed: function () {
        if ( this.get( 'status' ) === O.Status.DESTROYED ) {
            var store = this.get( 'store' ),
                calendarId = this.get( 'id' ),
                eventIds = [];
            if ( !store.isNested ) {
                store.findAll( JMAP.CalendarEvent, function ( data ) {
                    if ( data.calendarId === calendarId ) {
                        eventIds.push( data.id );
                    }
                    return false;
                });
                if ( eventIds.length ) {
                    store.sourceDidDestroyRecords(
                        JMAP.CalendarEvent, eventIds );
                }
            }
        }
    }.observes( 'status' )
});

JMAP.calendar.handle( Calendar, {
    precedence: 1,
    fetch: 'getCalendars',
    refresh: function ( _, state ) {
        this.callMethod( 'getCalendarUpdates', {
            sinceState: state,
            fetchRecords: true
        });
    },
    commit: 'setCalendars',
    // Response handlers
    calendars: function ( args, reqMethod, reqArgs ) {
        this.didFetch( Calendar, args,
            reqMethod === 'getCalendars' && !reqArgs.ids );
    },
    calendarUpdates: function ( args ) {
        this.didFetchUpdates( Calendar, args );
    },
    error_getCalendarUpdates_cannotCalculateChanges: function () {
        // All our data may be wrong. Refetch everything.
        this.fetchAllRecords( Calendar );
    },
    calendarsSet: function ( args ) {
        this.didCommit( Calendar, args );
    }
});

JMAP.Calendar = Calendar;

}( JMAP ) );
