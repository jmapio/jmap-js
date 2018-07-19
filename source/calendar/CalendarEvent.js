// -------------------------------------------------------------------------- \\
// File: CalendarEvent.js                                                     \\
// Module: CalendarModel                                                      \\
// Requires: API, Calendar.js, Duration.js, RecurrenceRule.js                 \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const clone = O.clone;
const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;
const TimeZone = O.TimeZone;

const calendar = JMAP.calendar;
const Calendar = JMAP.Calendar;
const Duration = JMAP.Duration;
const RecurrenceRule = JMAP.RecurrenceRule;
const uuidCreate = JMAP.uuid.create;
const YEARLY = RecurrenceRule.YEARLY;
const MONTHLY = RecurrenceRule.MONTHLY;
const WEEKLY = RecurrenceRule.WEEKLY;

// ---

const numerically = function ( a, b ) {
    return a - b;
};

const CalendarEvent = Class({

    Extends: Record,

    isDragging: false,
    isOccurrence: false,

    isEditable: function () {
        var calendar = this.get( 'calendar' );
        return ( !calendar || calendar.get( 'mayWrite' ) );
    }.property( 'calendar' ),

    isInvitation: function () {
        var participants = this.get( 'participants' );
        var participantId = this.get( 'participantId' );
        return !!( participants && (
            !participantId ||
            !participants[ participantId ].roles.contains( 'owner' )
        ));
    }.property( 'participants', 'participantId' ),

    storeWillUnload: function () {
        this._clearOccurrencesCache();
        CalendarEvent.parent.storeWillUnload.call( this );
    },

    clone: function ( store ) {
        var clone = CalendarEvent.parent.clone.call( this, store );
        clone.set( 'uid', uuidCreate() );
        return clone;
    },

    // --- JMAP

    calendar: Record.toOne({
        Type: Calendar,
        key: 'calendarId',
        willSet: function ( propValue, propKey, record ) {
            record.set( 'accountId', propValue.get( 'accountId' ) );
            return true;
        },
    }),

    // --- Metadata

    '@type': attr( String, {
        defaultValue: 'jsevent',
    }),

    uid: attr( String ),

    relatedTo: attr( Object ),

    prodId: attr( String ),

    created: attr( Date, {
        toJSON: Date.toUTCJSON,
        noSync: true,
    }),

    updated: attr( Date, {
        toJSON: Date.toUTCJSON,
        noSync: true,
    }),

    sequence: attr( Number, {
        defaultValue: 0,
        noSync: true,
    }),

    // method: attr( String, {
    //     noSync: true,
    // }),

    // --- What

    title: attr( String, {
        defaultValue: '',
    }),

    description: attr( String, {
        defaultValue: '',
    }),

    // --- Where

    locations: attr( Object, {
        defaultValue: null,
    }),

    location: function ( value ) {
        if ( value !== undefined ) {
            this.set( 'locations', value ? {
                '1': {
                    name: value
                }
            } : null );
        } else {
            var locations = this.get( 'locations' );
            if ( locations ) {
                value = Object.values( locations )[0].name || '';
            } else {
                value = '';
            }
        }
        return value;
    }.property( 'locations' ).nocache(),

    startLocationTimeZone: function () {
        var locations = this.get( 'locations' );
        var timeZone = this.get( 'timeZone' );
        var id, location;
        if ( timeZone ) {
            for ( id in locations ) {
                location = locations[ id ];
                if ( location.rel === 'start' ) {
                    if ( location.timeZone ) {
                        timeZone = TimeZone.fromJSON( location.timeZone );
                    }
                    break;
                }
            }
        }
        return timeZone;
    }.property( 'locations', 'timeZone' ),

    endLocationTimeZone: function () {
        var locations = this.get( 'locations' );
        var timeZone = this.get( 'timeZone' );
        var id, location;
        if ( timeZone ) {
            for ( id in locations ) {
                location = locations[ id ];
                if ( location.rel === 'end' ) {
                    if ( location.timeZone ) {
                        timeZone = TimeZone.fromJSON( location.timeZone );
                    }
                    break;
                }
            }
        }
        return timeZone;
    }.property( 'locations', 'timeZone' ),

    // --- Attachments

    links: attr( Object, {
        defaultValue: null,
    }),

    // ---

    // locale: attr( String ),
    // localizations: attr( Object ),

    // keywords: attr( Array ),
    // categories: attr( Array ),
    // color: attr( String ),

    // --- When

    isAllDay: attr( Boolean, {
        defaultValue: false,
    }),

    start: attr( Date, {
        willSet: function ( propValue, propKey, record ) {
            var oldStart = record.get( 'start' );
            if ( typeof oldStart !== 'undefined' ) {
                record._updateRecurrenceOverrides( oldStart, propValue );
            }
            return true;
        }
    }),

    duration: attr( Duration, {
        defaultValue: Duration.ZERO,
    }),

    timeZone: attr( TimeZone, {
        defaultValue: null,
    }),

    recurrenceRule: attr( RecurrenceRule, {
        defaultValue: null,
        willSet: function ( propValue, propKey, record ) {
            if ( !propValue ) {
                record.set( 'recurrenceOverrides', null );
            }
            return true;
        },
    }),

    recurrenceOverrides: attr( Object, {
        defaultValue: null,
    }),

    getStartInTimeZone: function ( timeZone ) {
        var eventTimeZone = this.get( 'timeZone' );
        var start, cacheKey;
        if ( eventTimeZone && timeZone && timeZone !== eventTimeZone ) {
            start = this.get( 'utcStart' );
            cacheKey = timeZone.id + start.toJSON();
            if ( this._ce_sk === cacheKey ) {
                return this._ce_s;
            }
            this._ce_sk = cacheKey;
            this._ce_s = start = timeZone.convertDateToTimeZone( start );
        } else {
            start = this.get( 'start' );
        }
        return start;
    },

    getEndInTimeZone: function ( timeZone ) {
        var eventTimeZone = this.get( 'timeZone' );
        var end = this.get( 'utcEnd' );
        var cacheKey;
        if ( eventTimeZone ) {
            if ( !timeZone ) {
                timeZone = eventTimeZone;
            }
            cacheKey = timeZone.id + end.toJSON();
            if ( this._ce_ek === cacheKey ) {
                return this._ce_e;
            }
            this._ce_ek = cacheKey;
            this._ce_e = end = timeZone.convertDateToTimeZone( end );
        }
        return end;
    },

    utcStart: function ( date ) {
        var timeZone = this.get( 'timeZone' );
        if ( date ) {
            this.set( 'start', timeZone ?
                timeZone.convertDateToTimeZone( date ) : date );
        } else {
            date = this.get( 'start' );
            if ( timeZone ) {
                date = timeZone.convertDateToUTC( date );
            }
        }
        return date;
    }.property( 'start', 'timeZone' ),

    utcEnd: function ( date ) {
        var utcStart = this.get( 'utcStart' );
        if ( date ) {
            this.set( 'duration', new Duration(
                Math.max( 0, date - utcStart )
            ));
        } else {
            date = new Date( +utcStart + this.get( 'duration' ) );
        }
        return date;
    }.property( 'utcStart', 'duration' ),

    end: function ( date ) {
        var isAllDay = this.get( 'isAllDay' );
        var timeZone = this.get( 'timeZone' );
        var utcStart, utcEnd;
        if ( date ) {
            utcStart = this.get( 'utcStart' );
            utcEnd = timeZone ?
                timeZone.convertDateToUTC( date ) : new Date( date );
            if ( isAllDay ) {
                utcEnd.add( 1, 'day' );
            }
            if ( utcStart > utcEnd ) {
                if ( isAllDay ||
                        !this.get( 'start' ).isOnSameDayAs( date, true ) ) {
                    this.set( 'utcStart', new Date(
                        +utcStart + ( utcEnd - this.get( 'utcEnd' ) )
                    ));
                } else {
                    utcEnd.add( 1, 'day' );
                    date = new Date( date ).add( 1, 'day' );
                }
            }
            this.set( 'utcEnd', utcEnd );
        } else {
            date = this.getEndInTimeZone( timeZone );
            if ( isAllDay ) {
                date = new Date( date ).subtract( 1, 'day' );
            }
        }
        return date;
    }.property( 'isAllDay', 'start', 'duration', 'timeZone' ),

    _updateRecurrenceOverrides: function ( oldStart, newStart ) {
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var newRecurrenceOverrides, delta, date;
        if ( recurrenceOverrides ) {
            delta = newStart - oldStart;
            newRecurrenceOverrides = {};
            for ( date in recurrenceOverrides ) {
                newRecurrenceOverrides[
                    new Date( +Date.fromJSON( date ) + delta ).toJSON()
                ] = recurrenceOverrides[ date ];
            }
            this.set( 'recurrenceOverrides', newRecurrenceOverrides );
        }
    },

    removedDates: function () {
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var dates = null;
        var date;
        if ( recurrenceOverrides ) {
            for ( date in recurrenceOverrides ) {
                if ( recurrenceOverrides[ date ].excluded ) {
                    if ( !dates ) { dates = []; }
                    dates.push( Date.fromJSON( date ) );
                }
            }
        }
        if ( dates ) {
            dates.sort( numerically );
        }
        return dates;
    }.property( 'recurrenceOverrides' ),

    _getOccurrenceForRecurrenceId: function ( id ) {
        var cache = this._ocache || ( this._ocache = {} );
        return cache[ id ] || ( cache[ id ] =
            new JMAP.CalendarEventOccurrence( this, id )
        );
    },

    // Return all occurrences that exist in this time range.
    // May return others outside of this range.
    // May return out of order.
    getOccurrencesThatMayBeInDateRange: function ( start, end, timeZone ) {
        // Get start time and end time in the event's time zone.
        var eventTimeZone = this.get( 'timeZone' );
        var recurrenceRule = this.get( 'recurrenceRule' );
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var duration, earliestStart;
        var occurrences, occurrencesSet, id, occurrence, date;
        var occurrenceIds, recurrences;

        // Convert start/end to local time
        if ( timeZone && eventTimeZone && timeZone !== eventTimeZone ) {
            start = timeZone.convertDateToUTC( start );
            start = eventTimeZone.convertDateToTimeZone( start );
            end = timeZone.convertDateToUTC( end );
            end = eventTimeZone.convertDateToTimeZone( end );
        }

        // Calculate earliest possible start date, given duration.
        // To prevent pathological cases, we limit duration to
        // the frequency of the recurrence.
        if ( recurrenceRule ) {
            duration = this.get( 'duration' ).valueOf();
            switch ( recurrenceRule.frequency ) {
            case YEARLY:
                duration = Math.min( duration, 366 * 24 * 60 * 60 * 1000 );
                break;
            case MONTHLY:
                duration = Math.min( duration,  31 * 24 * 60 * 60 * 1000 );
                break;
            case WEEKLY:
                duration = Math.min( duration,   7 * 24 * 60 * 60 * 1000 );
                break;
            default:
                duration = Math.min( duration,       24 * 60 * 60 * 1000 );
                break;
            }
            earliestStart = new Date( start - duration + 1000 );
        }

        // Precompute count, as it's expensive to do each time.
        if ( recurrenceRule && recurrenceRule.count ) {
            occurrences = this.get( 'allStartDates' );
            recurrences = occurrences.length ?
                occurrences.map( function ( date ) {
                    return this._getOccurrenceForRecurrenceId( date.toJSON() );
                }, this ) :
                null;
        } else {
            // Get occurrences that start within the time period.
            if ( recurrenceRule ) {
                occurrences = recurrenceRule.getOccurrences(
                    this.get( 'start' ), earliestStart, end
                );
            }
            // Or just the start if no recurrence rule.
            else {
                occurrences = [ this.get( 'start' ) ];
            }
            // Add overrides.
            if ( recurrenceOverrides ) {
                occurrencesSet = occurrences.reduce( function ( set, date ) {
                    set[ date.toJSON() ] = true;
                    return set;
                }, {} );
                for ( id in recurrenceOverrides ) {
                    occurrence = recurrenceOverrides[ id ];
                    // Remove EXDATEs.
                    if ( occurrence.excluded ) {
                        delete occurrencesSet[ id ];
                    }
                    // Add RDATEs.
                    else {
                        date = Date.fromJSON( id );
                        // Include if in date range, or if it alters the date.
                        if ( ( earliestStart <= date && date < end ) ||
                                occurrence.start ||
                                occurrence.duration ||
                                occurrence.timeZone ) {
                            occurrencesSet[ id ] = true;
                        }
                    }
                }
                occurrenceIds = Object.keys( occurrencesSet );
            } else {
                occurrenceIds = occurrences.map( function ( date ) {
                    return date.toJSON();
                });
            }
            // Get event occurrence objects
            recurrences = occurrenceIds.length ?
                occurrenceIds.map( this._getOccurrenceForRecurrenceId, this ) :
                null;
        }

        return recurrences;
    },

    // Exceptions changing the date/time of an occurrence are ignored: the
    // *original* date/time is still included in the allStartDates array.
    allStartDates: function () {
        var recurrenceRule = this.get( 'recurrenceRule' );
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var start = this.get( 'start' );
        var dates, occurrencesSet, id;

        if ( recurrenceRule &&
                !recurrenceRule.until && !recurrenceRule.count ) {
            return [ start ];
        }
        if ( recurrenceRule ) {
            dates = recurrenceRule.getOccurrences( start, null, null );
        } else {
            dates = [ start ];
        }
        if ( recurrenceOverrides ) {
            occurrencesSet = dates.reduce( function ( set, date ) {
                set[ date.toJSON() ] = true;
                return set;
            }, {} );
            for ( id in recurrenceOverrides ) {
                // Remove EXDATEs.
                if ( recurrenceOverrides[ id ].excluded ) {
                    delete occurrencesSet[ id ];
                }
                // Add RDATEs.
                else {
                    occurrencesSet[ id ] = true;
                }
            }
            dates = Object.keys( occurrencesSet ).map( Date.fromJSON );
            dates.sort( numerically );
        }
        return dates;
    }.property( 'start', 'recurrenceRule', 'recurrenceOverrides' ),

    totalOccurrences: function () {
        var recurrenceRule = this.get( 'recurrenceRule' );
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        if ( !recurrenceRule && !recurrenceOverrides ) {
            return 1;
        }
        if ( recurrenceRule &&
                !recurrenceRule.count && !recurrenceRule.until ) {
            return Number.MAX_VALUE;
        }
        return this.get( 'allStartDates' ).length;
    }.property( 'allStartDates' ),

    _clearOccurrencesCache: function () {
        var cache = this._ocache;
        var id;
        if ( cache ) {
            for ( id in cache ) {
                cache[ id ].unload();
            }
            this._ocache = null;
        }
    }.observes( 'start', 'timeZone', 'recurrence' ),

    _notifyOccurrencesOfPropertyChange: function ( _, key ) {
        var cache = this._ocache;
        var id;
        if ( cache ) {
            for ( id in cache ) {
                cache[ id ].propertyDidChange( key );
            }
        }
    }.observes( 'calendar', 'uid', 'relatedTo', 'prodId', 'isAllDay',
        'allStartDates', 'totalOccurrences', 'replyTo', 'participantId' ),

    // --- Scheduling

    // priority: attr( Number, {
    //     defaultValue: 0,
    // }),

    scheduleStatus: attr( String, {
        key: 'status',
        defaultValue: 'confirmed',
    }),

    freeBusyStatus: attr( String, {
        defaultValue: 'busy',
    }),

    replyTo: attr( Object, {
        defaultValue: null,
    }),

    participants: attr( Object, {
        defaultValue: null,
    }),

    // --- JMAP Scheduling

    // The id for the calendar owner's participant
    participantId: attr( String, {
        defaultValue: null,
    }),

    rsvp: function ( rsvp ) {
        var participants = this.get( 'participants' );
        var participantId = this.get( 'participantId' );
        var you = ( participants && participantId &&
            participants[ participantId ] ) || null;
        if ( you && rsvp !== undefined ) {
            participants = clone( participants );
            // Don't alert me if I'm not going!
            if ( rsvp === 'declined' ) {
                this.set( 'useDefaultAlerts', false )
                    .set( 'alerts', null );
            }
            // Do alert me if I change my mind!
            else if ( you.rsvpResponse === 'declined' &&
                    this.get( 'alerts' ) === null ) {
                this.set( 'useDefaultAlerts', true );
            }
            participants[ participantId ].rsvpResponse = rsvp;
            this.set( 'participants', participants );
        } else {
            rsvp = you && you.rsvpResponse || '';
        }
        return rsvp;
    }.property( 'participants', 'participantId' ),

    // --- Sharing

    // privacy: attr( String, {
    //     defaultValue: 'public',
    // }),

    // --- Alerts

    useDefaultAlerts: attr( Boolean, {
        defaultValue: false,
    }),

    alerts: attr( Object, {
        defaultValue: null,
    }),
});
CalendarEvent.__guid__ = 'CalendarEvent';
CalendarEvent.dataGroup = 'urn:ietf:params:jmap:calendars';

// ---

const dayToNumber = RecurrenceRule.dayToNumber;

const byNthThenDay = function ( a, b ) {
    var aNthOfPeriod = a.nthOfPeriod || 0;
    var bNthOfPeriod = b.nthOfPeriod || 0;
    return ( aNthOfPeriod - bNthOfPeriod ) ||
        ( dayToNumber[ a.day ] - dayToNumber[ b.day ] );
};

const numericArrayProps = [ 'byMonthDay', 'byYearDay', 'byWeekNo', 'byHour', 'byMinute', 'bySecond', 'bySetPosition' ];

const normaliseRecurrenceRule = function ( recurrenceRuleJSON ) {
    var byDay, byMonth, i, l, key, value;
    if ( !recurrenceRuleJSON ) {
        return;
    }
    if ( recurrenceRuleJSON.interval === 1 ) {
        delete recurrenceRuleJSON.interval;
    }
    if ( recurrenceRuleJSON.firstDayOfWeek === 'monday' ) {
        delete recurrenceRuleJSON.firstDayOfWeek;
    }
    if (( byDay = recurrenceRuleJSON.byDay )) {
        if ( byDay.length ) {
            byDay.sort( byNthThenDay );
        } else {
            delete recurrenceRuleJSON.byDay;
        }
    }
    if (( byMonth = recurrenceRuleJSON.byMonth )) {
        if ( byMonth.length ) {
            byMonth.sort();
        } else {
            delete recurrenceRuleJSON.byMonth;
        }
    }
    for ( i = 0, l = numericArrayProps.length; i < l; i += 1 ) {
        key = numericArrayProps[i];
        value = recurrenceRuleJSON[ key ];
        if ( value ) {
            // Must be sorted
            if ( value.length ) {
                value.sort( numerically );
            }
            // Must not be empty
            else {
                delete recurrenceRuleJSON[ key ];
            }
        }
    }
};

calendar.replaceEvents = {};
calendar.handle( CalendarEvent, {

    precedence: 2,

    fetch: 'CalendarEvent',
    refresh: 'CalendarEvent',
    commit: 'CalendarEvent',

    // ---

    'CalendarEvent/get': function ( args ) {
        var events = args.list;
        var l = events.length;
        var event, timeZoneId;
        var accountId = args.accountId;
        while ( l-- ) {
            event = events[l];
            timeZoneId = event.timeZone;
            if ( timeZoneId ) {
                calendar.seenTimeZone( TimeZone[ timeZoneId ] );
            }
            normaliseRecurrenceRule( event.recurrenceRule );
        }
        calendar.propertyDidChange( 'usedTimeZones' );
        this.didFetch( CalendarEvent, args, !!this.replaceEvents[ accountId ] );
        this.replaceEvents[ accountId ] = false;
    },

    'CalendarEvent/changes': function ( args ) {
        const hasDataForChanged = true;
        this.didFetchUpdates( CalendarEvent, args, hasDataForChanged );
        if ( args.hasMoreChanges ) {
            this.get( 'store' ).fetchAll( args.accountId, CalendarEvent, true );
        }
    },

    'error_CalendarEvent/changes_cannotCalculateChanges': function ( _, __, reqArgs ) {
        var accountId = reqArgs.accountId;
        calendar.flushCache( accountId );
    },

    'CalendarEvent/set': function ( args ) {
        this.didCommit( CalendarEvent, args );
    },
});

// --- Export

JMAP.CalendarEvent = CalendarEvent;

}( JMAP ) );
