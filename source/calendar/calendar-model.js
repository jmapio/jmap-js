// -------------------------------------------------------------------------- \\
// File: calendar-model.js                                                    \\
// Module: CalendarModel                                                      \\
// Requires: API, Calendar.js, CalendarEvent.js                               \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const store = JMAP.store;
const Calendar = JMAP.Calendar;
const CalendarEvent = JMAP.CalendarEvent;

// ---

const nonRepeatingEvents = new O.Object({

    index: null,

    clearIndex: function () {
        this.index = null;
    },

    buildIndex: function () {
        var index = this.index = {};
        var timeZone = JMAP.calendar.get( 'timeZone' );
        var storeKeys = store.findAll( CalendarEvent, function ( data ) {
            return !data.recurrenceRule && !data.recurrenceOverrides;
        });
        var i = 0;
        var l = storeKeys.length;
        var event, timestamp, end, events;
        for ( ; i < l; i += 1 ) {
            event = store.materialiseRecord( storeKeys[i], CalendarEvent );
            timestamp = +event.getStartInTimeZone( timeZone );
            timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
            end = +event.getEndInTimeZone( timeZone );
            do {
                events = index[ timestamp ] || ( index[ timestamp ] = [] );
                events.push( event );
                timestamp += ( 24 * 60 * 60 * 1000 );
            } while ( timestamp < end );
        }
        return this;
    },

    getEventsForDate: function ( date ) {
        var timestamp = +date;
        timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
        if ( !this.index ) {
            this.buildIndex();
        }
        return this.index[ timestamp ] || null;
    }
});

const repeatingEvents = new O.Object({

    start: null,
    end: null,
    index: null,

    records: function () {
        var storeKeys = store.findAll( CalendarEvent, function ( data ) {
            return !!data.recurrenceRule || !!data.recurrenceOverrides;
        });
        var i = 0;
        var l = storeKeys.length;
        var records = new Array( l );
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
        var startIndexStamp = +start;
        var endIndexStamp = +end;
        var index = this.index = {};
        var timeZone = JMAP.calendar.get( 'timeZone' );
        var records = this.get( 'records' );
        var i = 0;
        var l = records.length;
        var event, occurs, j, ll, occurrence, timestamp, endStamp, events;

        while ( i < l ) {
            event = records[i];
            occurs = event
                .getOccurrencesThatMayBeInDateRange( start, end, timeZone );
            for ( j = 0, ll = occurs ? occurs.length : 0; j < ll; j += 1 ) {
                occurrence = occurs[j];
                timestamp = +occurrence.getStartInTimeZone( timeZone );
                timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
                timestamp = Math.max( startIndexStamp, timestamp );
                endStamp = +occurrence.getEndInTimeZone( timeZone );
                endStamp = Math.min( endIndexStamp, endStamp );
                do {
                    events = index[ timestamp ] || ( index[ timestamp ] = [] );
                    events.push( occurrence );
                    timestamp += ( 24 * 60 * 60 * 1000 );
                } while ( timestamp < endStamp );
            }
            i += 1;
        }
        return this;
    },

    getEventsForDate: function ( date ) {
        var timestamp = +date;
        timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
        if ( !this.index || date < this.start || date >= this.end ) {
            this.buildIndex( date );
        }
        return this.index[ timestamp ] || null;
    }
});

// ---

/*
    If time zone is null -> consider each event in its native time zone.
    Otherwise, consider each event in the time zone given.

    date     - {Date} The date.
*/
const NO_EVENTS = [];
const eventSources = [ nonRepeatingEvents, repeatingEvents ];
const sortByStartInTimeZone = function ( timeZone ) {
    return function ( a, b ) {
        var aStart = a.getStartInTimeZone( timeZone ),
            bStart = b.getStartInTimeZone( timeZone );
        return aStart < bStart ? -1 : aStart > bStart ? 1 : 0;
    };
};

const getEventsForDate = function ( date, timeZone, allDay ) {
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
                ( showDeclined || event.get( 'rsvp' ) !== 'declined' ) &&
                ( !allDay || event.get( 'isAllDay' ) === ( allDay > 0 ) );
        });

        // And sort
        results.sort( sortByStartInTimeZone( timeZone ) );
    }

    return results || NO_EVENTS;
};

// ---

const eventsLists = [];

const EventsList = O.Class({

    Extends: O.ObservableArray,

    init: function ( date, allDay ) {
        this.date = date;
        this.allDay = allDay;

        eventsLists.push( this );

        EventsList.parent.constructor.call( this,
            getEventsForDate( date, JMAP.calendar.get( 'timeZone' ), allDay ));
    },

    destroy: function () {
        eventsLists.erase( this );
        EventsList.parent.destroy.call( this );
    },

    recalculate: function () {
        return this.set( '[]', getEventsForDate(
            this.date, JMAP.calendar.get( 'timeZone' ), this.allDay ));
    }
});

// ---

const toUTCDay = function ( date ) {
    return new Date( date - ( date % ( 24 * 60 * 60 * 1000 ) ) );
};

const twelveWeeks = 12 * 7 * 24 * 60 * 60 * 1000;
const now = new Date();
const usedTimeZones = {};
var editStore;

Object.assign( JMAP.calendar, {

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
    usedTimeZones: usedTimeZones,

    loadingEventsStart: now,
    loadingEventsEnd: now,
    loadedEventsStart: now,
    loadedEventsEnd: now,

    // allDay -> 0 (either), 1 (yes), -1 (no)
    getEventsForDate: function ( date, allDay ) {
        this.loadEvents( date );
        return new EventsList( date, allDay );
    },

    fetchEventsInRange: function ( after, before, callback ) {
        this.callMethod( 'getCalendarEventList', {
            filter: {
                after: after.toJSON() + 'Z',
                before: before.toJSON() + 'Z',
            },
        });
        this.callMethod( 'getCalendarEvents', {
            '#ids': {
                resultOf: this.getPreviousMethodId(),
                path: '/ids',
            }
        }, callback );
        return this;
    },

    loadEvents: function ( date ) {
        var loadingEventsStart = this.loadingEventsStart;
        var loadingEventsEnd = this.loadingEventsEnd;
        var start, end;
        if ( loadingEventsStart === loadingEventsEnd ) {
            start = toUTCDay( date ).subtract( 16, 'week' );
            end = toUTCDay( date ).add( 48, 'week' );
            this.fetchEventsInRange( start, end, function () {
                JMAP.calendar
                    .set( 'loadedEventsStart', start )
                    .set( 'loadedEventsEnd', end );
            });
            this.set( 'loadingEventsStart', start );
            this.set( 'loadingEventsEnd', end );
            return;
        }
        if ( date < +loadingEventsStart + twelveWeeks ) {
            start = toUTCDay( date < loadingEventsStart ?
                date : loadingEventsStart
            ).subtract( 24, 'week' );
            this.fetchEventsInRange( start, loadingEventsStart, function () {
                JMAP.calendar.set( 'loadedEventsStart', start );
            });
            this.set( 'loadingEventsStart', start );
        }
        if ( date > +loadingEventsEnd - twelveWeeks ) {
            end = toUTCDay( date > loadingEventsEnd ?
                date : loadingEventsEnd
            ).add( 24, 'week' );
            this.fetchEventsInRange( loadingEventsEnd, end, function () {
                JMAP.calendar.set( 'loadedEventsEnd', end );
            });
            this.set( 'loadingEventsEnd', end );
        }
    },

    clearIndexes: function () {
        nonRepeatingEvents.clearIndex();
        repeatingEvents.clearIndex();
        this.recalculate();
    }.observes( 'timeZone' ),

    recalculate: function () {
        eventsLists.forEach( function ( eventsList ) {
            eventsList.recalculate();
        });
    }.queue( 'before' ).observes( 'showDeclined' ),

    flushCache: function () {
        this.replaceEvents = true;
        this.fetchEventsInRange( this.loadedEventsStart, this.loadedEventsEnd );
    },

    seenTimeZone: function ( timeZone ) {
        if ( timeZone ) {
            var timeZoneId = timeZone.id;
            usedTimeZones[ timeZoneId ] =
                ( usedTimeZones[ timeZoneId ] || 0 ) + 1;
        }
        return this;
    }
});
store.on( Calendar, JMAP.calendar, 'recalculate' )
     .on( CalendarEvent, JMAP.calendar, 'clearIndexes' );

JMAP.calendar.handle( null, {
    calendarEventList: function () {
        // We don't care about the list, we only use it to fetch the
        // events we want. This may change with search in the future!
    }
});

}( JMAP ) );
