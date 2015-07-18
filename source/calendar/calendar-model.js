// -------------------------------------------------------------------------- \\
// File: calendar-model.js                                                    \\
// Module: CalendarModel                                                      \\
// Requires: API, Calendar.js, CalendarEvent.js                               \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. All rights reserved.                \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP ) {

var store = JMAP.store;
var Calendar = JMAP.Calendar;
var CalendarEvent = JMAP.CalendarEvent;

// ---

var nonRepeatingEvents = new O.Object({

    index: null,

    clearIndex: function () {
        this.index = null;
    },

    buildIndex: function () {
        var index = this.index = {},
            timeZone = JMAP.calendar.get( 'timeZone' ),
            storeKeys = store.findAll( CalendarEvent, function ( data ) {
                return !data.recurrence;
            }),
            i = 0, l = storeKeys.length,
            event, timestamp, end, events;
        for ( ; i < l; i += 1 ) {
            event = store.materialiseRecord( storeKeys[i], CalendarEvent );
            timestamp = +event.getStartDateInTZ( timeZone );
            timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
            end = +event.getEndDateInTZ( timeZone );
            while ( timestamp < end ) {
                events = index[ timestamp ] || ( index[ timestamp ] = [] );
                events.push( event );
                timestamp += ( 24 * 60 * 60 * 1000 );
            }
        }
        return this;
    },

    getEventsForDate: function ( date ) {
        if ( !this.index ) {
            this.buildIndex();
        }
        var timestamp = +date;
        timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
        return this.index[ timestamp ] || null;
    }
});

var repeatingEvents = new O.Object({

    start: null,
    end: null,
    index: null,

    records: function () {
        var storeKeys = store.findAll( CalendarEvent, function ( data ) {
                return !!data.recurrence;
            }),
            i = 0, l = storeKeys.length,
            records = new Array( l );
        for ( ; i < l; i += 1 ) {
            records[i] = store.materialiseRecord( storeKeys[i], CalendarEvent );
        }
        return records;
    }.property(),

    clearIndex: function () {
        this.computedPropertyDidChange( 'records' );
        this.start = null;
        this.end = null;
        this.index = null;
    },

    buildIndex: function ( date ) {
        var start = this.start = new Date( date ).subtract( 60 );
        var end = this.end = new Date( date ).add( 120 );
        var index = this.index = {},
            timeZone = JMAP.calendar.get( 'timeZone' ),
            records = this.get( 'records' ),
            i = 0, l = records.length,
            event, occurs, j, ll, occurrence,
            timestamp, endStamp, events;

        while ( i < l ) {
            event = records[i];
            occurs = event.getOccurrencesForDateRange( start, end, timeZone );
            for ( j = 0, ll = occurs ? occurs.length : 0; j < ll; j += 1 ) {
                occurrence = occurs[j];
                timestamp = +occurrence.getStartDateInTZ( timeZone );
                timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
                endStamp = +occurrence.getEndDateInTZ( timeZone );
                while ( timestamp < endStamp ) {
                    events = index[ timestamp ] || ( index[ timestamp ] = [] );
                    events.push( occurrence );
                    timestamp += ( 24 * 60 * 60 * 1000 );
                }
            }
            i += 1;
        }
        return this;
    },

    getEventsForDate: function ( date ) {
        if ( !this.index || date < this.start || date >= this.end ) {
            this.buildIndex( date );
        }
        var timestamp = +date;
        timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
        return this.index[ timestamp ] || null;
    }
});

// ---

/*
    If time zone is null -> consider each event in its native time zone.
    Otherwise, consider each event in the time zone given.

    date     - {Date} The date.
*/
var NO_EVENTS = [];
var eventSources = [ nonRepeatingEvents, repeatingEvents ];
var sortByStartInTimeZone = function ( timeZone ) {
    return function ( a, b ) {
        var aStart = a.getStartDateInTZ( timeZone ),
            bStart = b.getStartDateInTZ( timeZone );
        return aStart < bStart ? -1 : aStart > bStart ? 1 : 0;
    };
};

var getEventsForDate = function ( date, timeZone, allDay ) {
    var l = eventSources.length;
    var i, results, events, showDeclined;
    for ( i = 0; i < l; i += 1 ) {
        events = eventSources[i].getEventsForDate( date );
        if ( events ) {
            results = results ? results.concat( events ) : events;
        }
    }

    if ( results ) {
        showDeclined = JMAP.calendar.get( 'showDeclined' );

        // Filter out all-day and invisible calendars.
        results = results.filter( function ( event ) {
            return event.get( 'calendar' ).get( 'isVisible' ) &&
                ( showDeclined || event.get( 'rsvp' ) !== 'no' ) &&
                ( !allDay || event.get( 'isAllDay' ) === ( allDay > 0 ) );
        });

        // And sort
        results.sort( sortByStartInTimeZone( timeZone ) );
    }

    return results || NO_EVENTS;
};

// ---

var eventLists = [];

var EventsList = O.Class({
    Extends: O.ObservableArray,
    init: function ( date, allDay ) {
        this.date = date;
        this.allDay = allDay;

        eventLists.push( this );

        EventsList.parent.init.call( this, getEventsForDate(
            date, JMAP.calendar.get( 'timeZone' ), allDay ));
    },
    destroy: function () {
        eventLists.erase( this );
        EventsList.parent.destroy.call( this );
    },
    recalculate: function () {
        return this.set( '[]', getEventsForDate(
            this.date, JMAP.calendar.get( 'timeZone' ), this.allDay ));
    }
});

// ---

var toUTCDay = function ( date ) {
    return new Date( date - ( date % ( 24 * 60 * 60 * 1000 ) ) );
};
var twelveWeeks = 12 * 7 * 24 * 60 * 60 * 1000;
var now = new Date();

var editStore;

O.extend( JMAP.calendar, {
    editStore: editStore = new O.NestedStore( store ),

    undoManager: new O.StoreUndoManager({
        store: editStore,
        maxUndoCount: 10
    }),

    eventSources: eventSources,
    repeatingEvents: repeatingEvents,
    nonRepeatingEvents: nonRepeatingEvents,

    showDeclined: false,
    timeZone: null,

    loadingEventsStart: now,
    loadingEventsEnd: now,
    loadedEventsStart: now,
    loadedEventsEnd: now,

    // allDay -> 0 (either), 1 (yes), -1 (no)
    getEventsForDate: function ( date, allDay ) {
        this.loadEvents( date );
        return new EventsList( date, allDay );
    },

    loadEvents: function ( date ) {
        var loadingEventsStart = this.loadingEventsStart;
        var loadingEventsEnd = this.loadingEventsEnd;
        var start, end;
        if ( loadingEventsStart === loadingEventsEnd ) {
            start = toUTCDay( date ).subtract( 24, 'week' );
            end = toUTCDay( date ).add( 24, 'week' );
            this.callMethod( 'getCalendarEventList', {
                filter: {
                    after: start,
                    before: end
                },
                fetchCalendarEvents: true
            }, function () {
                JMAP.calendar
                    .set( 'loadedEventsStart', start )
                    .set( 'loadedEventsEnd', end );
            });
            this.loadingEventsStart = start;
            this.loadingEventsEnd = end;
            return;
        }
        if ( date < +loadingEventsStart + twelveWeeks ) {
            start = toUTCDay( date < loadingEventsStart ?
                date : loadingEventsStart
            ).subtract( 24, 'week' );
            this.callMethod( 'getCalendarEventList', {
                filter: {
                    after: start,
                    before: loadingEventsStart
                },
                fetchCalendarEvents: true
            }, function () {
                JMAP.calendar.set( 'loadedEventsStart', start );
            });
            this.loadingEventsStart = start;
        }
        if ( date > +loadingEventsEnd - twelveWeeks ) {
            end = toUTCDay( date > loadingEventsEnd ?
                date : loadingEventsEnd
            ).add( 24, 'week' );
            this.callMethod( 'getCalendarEventList', {
                filter: {
                    after: loadingEventsEnd,
                    before: end
                },
                fetchCalendarEvents: true
            }, function () {
                JMAP.calendar.set( 'loadedEventsEnd', end );
            });
            this.loadingEventsEnd = end;
        }
    },

    clearIndexes: function () {
        nonRepeatingEvents.clearIndex();
        repeatingEvents.clearIndex();
        this.recalculate();
    }.observes( 'timeZone' ),

    recalculate: function () {
        eventLists.forEach( function ( eventList ) {
            eventList.recalculate();
        });
    }.queue( 'before' ).observes( 'showDeclined' ),

    flushCache: function () {
        this.replaceEvents = true;
        this.callMethod( 'getCalendarEventList', {
            filter: {
                after: this.loadedEventsStart,
                before: this.loadedEventsEnd
            },
            fetchCalendarEvents: true
        });
    }
});
store.on( Calendar, JMAP.calendar, 'recalculate' )
     .on( CalendarEvent, JMAP.calendar, 'clearIndexes' );

JMAP.calendar.handle( null, {
    calendarEventList: function () {
        // We don't care about the list, we only use it to fetch the
        // events we want. This may change with search in the future!
    },
    error_getCalendarEventUpdates_cannotCalculateChanges: function () {
        JMAP.calendar.flushCache();
    }
});

}( JMAP ) );
