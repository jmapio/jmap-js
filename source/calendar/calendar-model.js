// -------------------------------------------------------------------------- \\
// File: calendar-model.js                                                    \\
// Module: CalendarModel                                                      \\
// Requires: API, Calendar.js, CalendarEvent.js, RecurrenceRule.js            \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const clone = O.clone;
const guid = O.guid;
const mixin = O.mixin;
const Class = O.Class;
const Obj = O.Object;
const ObservableArray = O.ObservableArray;
const NestedStore = O.NestedStore;
const StoreUndoManager = O.StoreUndoManager;

const auth = JMAP.auth;
const store = JMAP.store;
const calendar = JMAP.calendar;
const Calendar = JMAP.Calendar;
const CalendarEvent = JMAP.CalendarEvent;
const RecurrenceRule = JMAP.RecurrenceRule;
const CALENDARS_DATA = auth.CALENDARS_DATA;

// ---

const TIMED_OR_ALL_DAY = 0
const ONLY_ALL_DAY = 1;
const ONLY_TIMED = -1;

// ---

const nonRepeatingEvents = new Obj({

    index: null,

    clearIndex: function () {
        this.index = null;
    },

    buildIndex: function () {
        var index = this.index = {};
        var timeZone = calendar.get( 'timeZone' );
        var storeKeys = store.findAll( CalendarEvent, function ( data ) {
            return !data.recurrenceRule && !data.recurrenceOverrides;
        });
        var i = 0;
        var l = storeKeys.length;
        var event, timestamp, end, events;
        for ( ; i < l; i += 1 ) {
            event = store.materialiseRecord( storeKeys[i] );
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
    },
});

const repeatingEvents = new Obj({

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
            records[i] = store.materialiseRecord( storeKeys[i] );
        }
        return records;
    }.property(),

    clearIndex: function () {
        this.computedPropertyDidChange( 'records' );
        this.start = null;
        this.end = null;
        this.index = null;
    },

    buildIndex: function ( start, end ) {
        var index = this.index || ( this.index = {} );
        var startIndexStamp = +start;
        var endIndexStamp = +end;
        var timeZone = calendar.get( 'timeZone' );
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
                // If starts after end of range being added to index, ignore
                if ( timestamp >= endIndexStamp ) {
                    continue;
                }
                endStamp = +occurrence.getEndInTimeZone( timeZone );
                // If ends before start of range being added to index, ignore
                if ( endStamp < startIndexStamp ) {
                    continue;
                }
                // Only add to days within index range
                timestamp = Math.max( startIndexStamp, timestamp );
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
        var start = this.start;
        var end = this.end;
        var timestamp = +date;
        timestamp = timestamp - timestamp.mod( 24 * 60 * 60 * 1000 );
        if ( !this.index ) {
            start = this.start = new Date( date ).subtract( 60 );
            end = this.end = new Date( date ).add( 120 );
            this.buildIndex( start, end );
        } else if ( date < start ) {
            end = start;
            start = this.start = new Date( date ).subtract( 120 );
            this.buildIndex( start, end );
        } else if ( date >= this.end ) {
            start = end;
            end = this.end = new Date( date ).add( 120 );
            this.buildIndex( start, end );
        }
        return this.index[ timestamp ] || null;
    },
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
        var aStart = a.getStartInTimeZone( timeZone );
        var bStart = b.getStartInTimeZone( timeZone );
        return aStart < bStart ? -1 : aStart > bStart ? 1 :
            a.get( 'uid' ) < b.get( 'uid' ) ? -1 : 1;
    };
};

const findEventsForDate = function ( date, allDay, filter ) {
    var l = eventSources.length;
    var timeZone = calendar.get( 'timeZone' );
    var i, results, events, showDeclined;
    for ( i = 0; i < l; i += 1 ) {
        events = eventSources[i].getEventsForDate( date );
        if ( events ) {
            results = results ? results.concat( events ) : events;
        }
    }

    if ( results ) {
        showDeclined = calendar.get( 'showDeclined' );

        // Filter out all-day and invisible calendars.
        results = results.filter( function ( event ) {
            return event.get( 'calendar' ).get( 'isEventsShown' ) &&
                ( showDeclined || event.get( 'rsvp' ) !== 'declined' ) &&
                ( !allDay || event.get( 'isAllDay' ) === ( allDay > 0 ) ) &&
                ( !filter || filter( event ) );
        });

        // And sort
        if ( results.length ) {
            results.sort( sortByStartInTimeZone( timeZone ) );
        } else {
            results = null;
        }
    }

    return results || NO_EVENTS;
};

// ---

const indexObservers = {};

const EventsList = Class({

    Extends: ObservableArray,

    init: function ( date, allDay, where ) {
        this.date = date;
        this.allDay = allDay;
        this.where = where;

        indexObservers[ guid( this ) ] = this;

        EventsList.parent.constructor.call( this,
            findEventsForDate( date, allDay, where ) );
    },

    destroy: function () {
        delete indexObservers[ guid( this ) ];
        EventsList.parent.destroy.call( this );
    },

    recalculate: function () {
        return this.set( '[]',
            findEventsForDate( this.date, this.allDay, this.where ) );
    },
});

// ---

const toUTCDay = function ( date ) {
    return new Date( date - ( date % ( 24 * 60 * 60 * 1000 ) ) );
};

const twelveWeeks = 12 * 7 * 24 * 60 * 60 * 1000;
const now = new Date();
const usedTimeZones = {};
var editStore;

mixin( calendar, {

    editStore: editStore = new NestedStore( store ),

    undoManager: new StoreUndoManager({
        store: editStore,
        maxUndoCount: 10
    }),

    /*  Issues with splitting:
        1. If split on an inclusion, the start date of the new recurrence
           may not match the recurrence, which can cause incorrect expansion
           for the future events.
        2. If the event has date-altering exceptions, these are ignored for
           the purposes of splitting.
    */
    splitEventAtOccurrence: function ( occurrence ) {
        var event = occurrence.get( 'original' );

        var recurrenceRule = event.get( 'recurrenceRule' );
        var recurrenceOverrides = event.get( 'recurrenceOverrides' );
        var recurrenceJSON = recurrenceRule ? recurrenceRule.toJSON() : null;
        var isFinite = !recurrenceRule ||
                !!( recurrenceRule.count || recurrenceRule.until );

        var allStartDates = event.get( 'allStartDates' );
        var occurrenceIndex = occurrence.get( 'index' );
        var occurrenceTotal = allStartDates.length;
        var isLast = isFinite && ( occurrenceIndex + 1 === occurrenceTotal );

        var startJSON = occurrence.get( 'id' );
        var start = Date.fromJSON( startJSON );

        var hasOverridesPast = false;
        var hasOverridesFuture = false;

        var pastRelatedTo, futureRelatedTo, uidOfFirst;
        var recurrenceOverridesPast, recurrenceOverridesFuture;
        var date;
        var toEditEvent;

        if ( !occurrenceIndex ) {
            return event;
        }

        // Duplicate original event
        event = event.getDoppelganger( editStore );
        if ( isLast ) {
            toEditEvent = occurrence.clone( editStore );
        } else {
            toEditEvent = event.clone( editStore )
                .set( 'start', occurrence.getOriginalForKey( 'start' ) );
        }

        // Set first/next relatedTo pointers
        pastRelatedTo = event.get( 'relatedTo' );
        uidOfFirst = pastRelatedTo &&
            Object.keys( pastRelatedTo ).find( function ( uid ) {
                return pastRelatedTo[ uid ].relation.first;
            }) ||
            event.get( 'uid' );

        futureRelatedTo = {};
        futureRelatedTo[ uidOfFirst ] = {
            relation: { first: true },
        };
        pastRelatedTo = pastRelatedTo ? clone( pastRelatedTo ) : {};
        pastRelatedTo[ toEditEvent.get( 'uid' ) ] = {
            relation: { next: true },
        };
        toEditEvent.set( 'relatedTo', futureRelatedTo );
        event.set( 'relatedTo',  pastRelatedTo );

        // Modify original recurrence start or end
        if ( isFinite && recurrenceRule && !recurrenceOverrides ) {
            if ( occurrenceIndex === 1 ) {
                event.set( 'recurrenceRule', null );
            } else {
                event.set( 'recurrenceRule',
                    RecurrenceRule.fromJSON( Object.assign( {}, recurrenceJSON,
                    recurrenceJSON.until ? {
                        until: allStartDates[ occurrenceIndex - 1 ].toJSON()
                    } : {
                        count: occurrenceIndex
                    }))
                );
            }
        } else if ( recurrenceRule ) {
            event.set( 'recurrenceRule',
                RecurrenceRule.fromJSON( Object.assign( {}, recurrenceJSON, {
                    count: null,
                    until: new Date( start - ( 24 * 60 * 60 * 1000 ) ).toJSON()
                }))
            );
        }

        // Set recurrence for new event
        if ( !isLast && recurrenceRule ) {
            if ( recurrenceJSON.count ) {
                toEditEvent.set( 'recurrenceRule',
                    RecurrenceRule.fromJSON( Object.assign( {}, recurrenceJSON,
                    // If there are RDATEs beyond the final normal
                    // occurrence this may result in extra events being added
                    // by the split. Left as a known issue for now.
                    recurrenceOverrides ? {
                        count: null,
                        until: allStartDates.last().toJSON()
                    } : {
                        count: occurrenceTotal - occurrenceIndex,
                        until: null
                    }))
                );
            } else {
                toEditEvent.set( 'recurrenceRule', recurrenceRule );
            }
        }

        // Split overrides
        if ( recurrenceOverrides ) {
            recurrenceOverridesPast = {};
            recurrenceOverridesFuture = {};
            for ( date in recurrenceOverrides ) {
                if ( date < startJSON ) {
                    recurrenceOverridesPast[ date ] =
                        recurrenceOverrides[ date ];
                    hasOverridesPast = true;
                } else {
                    recurrenceOverridesFuture[ date ] =
                        recurrenceOverrides[ date ];
                    hasOverridesFuture = true;
                }
            }
            event.set( 'recurrenceOverrides',
                hasOverridesPast ? recurrenceOverridesPast : null );
            if ( !isLast ) {
                toEditEvent.set( 'recurrenceOverrides',
                    hasOverridesFuture ? recurrenceOverridesFuture : null );
            }
        }

        // Save new event to store
        return toEditEvent.saveToStore();
    },

    // ---

    showDeclined: false,
    timeZone: null,
    usedTimeZones: usedTimeZones,

    eventSources: eventSources,
    repeatingEvents: repeatingEvents,
    nonRepeatingEvents: nonRepeatingEvents,
    indexObservers: indexObservers,

    loadingEventsStart: now,
    loadingEventsEnd: now,
    loadedEventsStart: now,
    loadedEventsEnd: now,

    findEventsForDate: findEventsForDate,

    getEventsForDate: function ( date, allDay, where ) {
        this.loadEvents( date );
        return new EventsList( date, allDay, where || null );
    },

    fetchEventsInRangeForAccount: function ( accountId, after, before ) {
        this.callMethod( 'CalendarEvent/query', {
            accountId: accountId,
            filter: {
                after: after.toJSON() + 'Z',
                before: before.toJSON() + 'Z',
            },
        });
        this.callMethod( 'CalendarEvent/get', {
            accountId: accountId,
            '#ids': {
                resultOf: this.getPreviousMethodId(),
                name: 'CalendarEvent/query',
                path: '/ids',
            },
        });
    },

    fetchEventsInRange: function ( after, before, callback ) {
        var accounts = auth.get( 'accounts' );
        var accountId, hasDataFor;
        for ( accountId in accounts ) {
            hasDataFor = accounts[ accountId ].hasDataFor;
            if ( hasDataFor.contains( CALENDARS_DATA ) ) {
                this.fetchEventsInRangeForAccount( accountId, after, before );
            }
        }
        if ( callback ) {
            this.addCallback( callback );
        }
        return this;
    },

    loadEventsInRange: function ( start, end ) {
        var loadingEventsStart = this.loadingEventsStart;
        var loadingEventsEnd = this.loadingEventsEnd;
        if ( start < loadingEventsStart ) {
            this.fetchEventsInRange( start, loadingEventsStart, function () {
                calendar.set( 'loadedEventsStart', start );
            });
            this.set( 'loadingEventsStart', start );
        }
        if ( end > loadingEventsEnd ) {
            this.fetchEventsInRange( loadingEventsEnd, end, function () {
                calendar.set( 'loadedEventsEnd', end );
            });
            this.set( 'loadingEventsEnd', end );
        }
        return this;
    },

    loadEvents: function ( date ) {
        var loadingEventsStart = this.loadingEventsStart;
        var loadingEventsEnd = this.loadingEventsEnd;
        var start = date;
        var end = date;
        if ( loadingEventsStart === loadingEventsEnd ) {
            start = toUTCDay( date ).subtract( 16, 'week' );
            end = toUTCDay( date ).add( 48, 'week' );
            this.fetchEventsInRange( start, end, function () {
                calendar
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
        }
        if ( date > +loadingEventsEnd - twelveWeeks ) {
            end = toUTCDay( date > loadingEventsEnd ?
                date : loadingEventsEnd
            ).add( 24, 'week' );
        }
        return this.loadEventsInRange( start, end );
    },

    clearIndexes: function () {
        nonRepeatingEvents.clearIndex();
        repeatingEvents.clearIndex();
        this.recalculate();
    }.observes( 'timeZone' ),

    recalculate: function () {
        Object.values( indexObservers ).forEach( function ( eventsList ) {
            eventsList.recalculate();
        });
    }.queue( 'before' ).observes( 'showDeclined' ),

    flushCache: function ( accountId ) {
        this.replaceEvents[ accountId ] = true;
        this.fetchEventsInRangeForAccount( accountId,
            this.loadedEventsStart, this.loadedEventsEnd );
    },

    // ---

    seenTimeZone: function ( timeZone ) {
        if ( timeZone ) {
            var timeZoneId = timeZone.id;
            usedTimeZones[ timeZoneId ] =
                ( usedTimeZones[ timeZoneId ] || 0 ) + 1;
        }
        return this;
    },

    // ---

    NO_EVENTS: NO_EVENTS,

    TIMED_OR_ALL_DAY: TIMED_OR_ALL_DAY,
    ONLY_ALL_DAY: ONLY_ALL_DAY,
    ONLY_TIMED: ONLY_TIMED,
});
store.on( Calendar, calendar, 'recalculate' )
     .on( CalendarEvent, calendar, 'clearIndexes' );

calendar.handle( null, {
    'CalendarEvent/query': function () {
        // We don't care about the list, we only use it to fetch the
        // events we want. This may change with search in the future!
    },
});

}( JMAP ) );
