// -------------------------------------------------------------------------- \\
// File: CalendarEvent.js                                                     \\
// Module: CalendarModel                                                      \\
// Requires: API, Calendar.js, RecurringDate.js                               \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP, undefined ) {

var Record = O.Record,
    attr = Record.attr;

var numerically = function ( a, b ) {
    return a - b;
};

var CalendarEvent = O.Class({

    Extends: Record,

    isDragging: false,
    isOccurrence: false,

    mayEdit: function () {
        var calendar = this.get( 'calendar' ),
            organizer = this.get( 'organizer' );
        return calendar.get( 'mayWrite' ) && ( !organizer || organizer.isYou );
    }.property( 'calendar', 'organizer' ),

    isInvitation: function () {
        var organizer = this.get( 'organizer' );
        return ( organizer && !organizer.isYou );
    }.property( 'organizer' ),

    storeWillUnload: function () {
        this._clearOccurrencesCache();
        CalendarEvent.parent.storeWillUnload.call( this );
    },

    // ---

    calendar: Record.toOne({
        Type: JMAP.Calendar,
        key: 'calendarId'
    }),

    summary: attr( String, {
        defaultValue: ''
    }),
    description: attr( String, {
        defaultValue: ''
    }),
    location: attr( String, {
        defaultValue: ''
    }),
    showAsFree: attr( Boolean, {
        defaultValue: false
    }),

    // ---

    isAllDay: attr( Boolean, {
        defaultValue: false
    }),

    // Local Time/Date string, e.g. 2011-03-12T03:04
    start: attr( Date, {
        defaultValue: new Date()
    }),
    end: attr( Date, {
        defaultValue: new Date().add( 1, 'hour' )
    }),

    // TimeZone
    startTimeZone: attr( O.TimeZone, {
        defaultValue: null
    }),
    endTimeZone: attr( O.TimeZone, {
        defaultValue: null
    }),

    getStartDateInTZ: function ( timeZone ) {
        var start = this.get( 'start' );
        var startTimeZone = this.get( 'startTimeZone' );
        var cacheKey;
        if ( startTimeZone ) {
            if ( !timeZone || timeZone === startTimeZone ) {
                return start;
            }
            start = this.get( 'utcStart' );
            cacheKey = timeZone.id + start.toJSON();
            if ( this._ce_sk === cacheKey ) {
                return this._ce_s;
            }
            this._ce_sk = cacheKey;
            this._ce_s = start = timeZone.convertDateToTimeZone( start );
        }
        return start;
    },

    getEndDateInTZ: function ( timeZone ) {
        var end = this.get( 'end' );
        var endTimeZone = this.get( 'endTimeZone' );
        var cacheKey;
        if ( endTimeZone ) {
            if ( !timeZone || timeZone === endTimeZone ) {
                return end;
            }
            end = this.get( 'utcEnd' );
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
        var timeZone = this.get( 'startTimeZone' );
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
    }.property( 'start', 'startTimeZone' ),

    utcEnd: function ( date ) {
        var timeZone = this.get( 'endTimeZone' );
        if ( date ) {
            this.set( 'end', timeZone ?
                timeZone.convertDateToTimeZone( date ) : date );
        } else {
            date = this.get( 'end' );
            if ( timeZone ) {
                date = timeZone.convertDateToUTC( date );
            }
        }
        return date;
    }.property( 'end', 'endTimeZone', 'isAllDay' ),

    localStart: function ( date ) {
        var start = this.get( 'start' );
        if ( date && !O.isEqual( date, start ) ) {
            this.set( 'end', new Date( +this.get( 'end' ) + ( date - start ) ) )
                .set( 'start', date );
        } else {
            date = start;
        }
        return date;
    }.property( 'start', 'startTimeZone' ).doNotNotify(),

    localEnd: function ( date ) {
        var isAllDay = this.get( 'isAllDay' ),
            timeZone = this.get( 'endTimeZone' ),
            utcStart, utcEnd;
        if ( date ) {
            utcStart = this.get( 'utcStart' );
            utcEnd = timeZone ?
                timeZone.convertDateToUTC( date ) : new Date( date );
            if ( isAllDay ) {
                utcEnd.add( 1, 'day' );
            }
            if ( utcStart > utcEnd ) {
                if ( isAllDay || !utcStart.isOnSameDayAs( utcEnd, true ) ) {
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
            date = this.get( 'end' );
            if ( isAllDay ) {
                date = new Date( date ).subtract( 1, 'day' );
            }
        }
        return date;
    }.property( 'end', 'endTimeZone', 'isAllDay' ).doNotNotify(),

    // ---

    duration: function ( duration ) {
        var utcStart = this.get( 'utcStart' );
        if ( duration !== undefined ) {
            this.set( 'utcEnd', new Date( +utcStart + duration ) );
        } else {
            duration = this.get( 'utcEnd' ) - utcStart;
        }
        return duration;
    }.property( 'utcStart', 'utcEnd' ),

    // ---

    recurrence: attr( JMAP.RecurringDate, {
        defaultValue: null
    }),

    inclusions: attr( Array, {
        defaultValue: null
    }),

    exceptions: attr( Object, {
        defaultValue: null
    }),

    _updateExceptions: function ( _, __, oldStart ) {
        var exceptions = this.get( 'exceptions' ),
            newExceptions, delta, date;
        if ( this.get( 'store' ).isNested && exceptions ) {
            newExceptions = {};
            delta = this.get( 'start' ) - oldStart;
            for ( date in exceptions ) {
                newExceptions[
                    new Date( +Date.fromJSON( date ) + delta ).toJSON()
                ] = exceptions[ date ];
            }
            this.set( 'exceptions', newExceptions );
        }
    }.observes( 'start' ),

    _removeRecurrence: function () {
        if ( this.get( 'store' ).isNested && !this.get( 'recurrence' ) ) {
            this.set( 'inclusions', null )
                .set( 'exceptions', null );
        }
    }.observes( 'recurrence' ),

    removedDates: function () {
        var exceptions = this.get( 'exceptions' ),
            dates = null,
            date;
        if ( exceptions ) {
            for ( date in exceptions ) {
                if ( !exceptions[ date ] ) {
                    if ( !dates ) { dates = []; }
                    dates.push( Date.fromJSON( date ) );
                }
            }
        }
        if ( dates ) {
            dates.sort( numerically );
        }
        return dates;
    }.property( 'exceptions' ),

    _getOccurrenceForDate: function ( date ) {
        var id = date.toJSON(),
            cache = this._ocache || ( this._ocache = {} );
        return cache[ id ] || ( cache[ id ] =
            new CalendarEventOccurrence( this, id, date )
        );
    },

    getOccurrencesForDateRange: function ( start, end, timeZone ) {
        // Get start time and end time in the event's time zone.
        var eventTimeZone = this.get( 'startTimeZone' ),
            recurrence = this.get( 'recurrence' ),
            inclusions = this.get( 'inclusions' ),
            exceptions = this.get( 'exceptions' ),
            needsFilter = false,
            earliestStart, occurrences,
            i, l, date, index,
            id, exception,
            recurrences;

        // Convert start/end to local time
        if ( timeZone && eventTimeZone && timeZone !== eventTimeZone ) {
            start = timeZone.convertDateToUTC( start );
            start = eventTimeZone.convertDateToTimeZone( start );
            end = timeZone.convertDateToUTC( end );
            end = eventTimeZone.convertDateToTimeZone( end );
        }

        // Calculate earliest possible start date, given duration
        earliestStart = new Date( start - this.get( 'duration' ) + 1000 );

        // Precompute count, as it's expensive to do each time.
        if ( recurrence.count ) {
            occurrences = this.get( 'allStartDates' );
            needsFilter = true;
        } else {
            // Get occurrences that start within the time period:
            occurrences = recurrence.getOccurrences(
                this.get( 'start' ), earliestStart, end
            );

            // Add inclusions
            if ( inclusions ) {
                for ( i = 0, l = inclusions.length; i < l; i += 1 ) {
                    date = inclusions[i];
                    if ( earliestStart <= date && date < end ) {
                        index = occurrences.binarySearch( date );
                        if ( !O.isEqual( occurrences[ index ], date ) ) {
                            occurrences.splice( index, 0, date );
                        }
                    }
                }
            }
            if ( exceptions ) {
                // Remove exceptions
                occurrences = occurrences.filter( function ( date ) {
                    return exceptions[ date.toJSON() ] !== null;
                });
                // Check for crazy time altering weirdness
                for ( id in exceptions ) {
                    exception = exceptions[ id ];
                    if ( exception && ( exception.start || exception.end ) ) {
                        date = Date.fromJSON( id );
                        index = occurrences.binarySearch( date );
                        if ( !O.isEqual( occurrences[ index ], date ) ) {
                            occurrences.splice( index, 0, date );
                        }
                        needsFilter = true;
                    }
                }
            }
        }

        // Get event occurrence objects
        recurrences = occurrences.length ?
            occurrences.map( this._getOccurrenceForDate, this ) : null;

        if ( recurrences && needsFilter ) {
            recurrences = recurrences.filter( function ( occurrence ) {
                return occurrence.get( 'start' ) < end &&
                    occurrence.get( 'end' ) > start -
                    ( occurrence.get( 'isAllDay' ) ? 24 * 60 * 60 * 1000 : 0 );
            });
        }
        return recurrences;
    },

    // Exceptions changing the date/time of an occurrence are ignored: the
    // *original* date/time is still included in the allStartDates array.
    allStartDates: function () {
        var recurrence = this.get( 'recurrence' ),
            inclusions = this.get( 'inclusions' ),
            exceptions = this.get( 'exceptions' ),
            start = this.get( 'start' ),
            dates;

        if ( !recurrence || ( !recurrence.until && !recurrence.count ) ) {
            return [ start ];
        }
        dates = recurrence.getOccurrences( start, null, null );
        if ( inclusions ) {
            dates = dates.concat( inclusions );
            dates.sort( numerically );
            // Deduplicate
            dates = dates.filter( function ( date, index, array ) {
                return !index || !O.isEqual( date, array[ index - 1 ] );
            });
        }
        if ( exceptions ) {
            dates = dates.filter( function ( date ) {
                return exceptions[ date.toJSON() ] !== null;
            });
        }
        return dates;
    }.property( 'start', 'startTimeZone',
        'recurrence', 'inclusions', 'exceptions' ),

    totalOccurrences: function () {
        var recurrence = this.get( 'recurrence' );
        if ( !recurrence ) {
            return 1;
        }
        if ( !recurrence.count && !recurrence.until ) {
            return Number.MAX_VALUE;
        }
        return this.get( 'allStartDates' ).length;
    }.property( 'allStartDates' ),

    _clearOccurrencesCache: function () {
        var cache = this._ocache,
            id;
        if ( cache ) {
            for ( id in cache ) {
                cache[ id ].unload();
            }
            this._ocache = null;
        }
    }.observes( 'start', 'startTimeZone', 'recurrence' ),

    // ---

    alerts: attr( Array, {
        defaultValue: null
    }),

    // ---

    organizer: attr( Object, {
        defaultValue: null
    }),
    attendees: attr( Array, {
        defaultValue: null
    }),

    rsvp: function ( rsvp ) {
        var attendees = this.get( 'attendees' ),
            you;
        if ( rsvp !== undefined ) {
            attendees = O.clone( attendees );
        }
        if ( attendees ) {
            you = attendees.find( function ( participant ) {
                return participant.isYou;
            });
        }
        if ( you && rsvp !== undefined ) {
            you.rsvp = rsvp;
            this.set( 'attendees', attendees );
        } else {
            rsvp = you ? you.rsvp : 'n/a';
        }
        return rsvp;
    }.property( 'attendees' ),

    // ---

    attachments: attr( Array, {
        defaultValue: null
    }),

    isUploading: function () {
        return !!JMAP.calendar.eventUploads.get( this ).length;
    }.property( 'files' ),

    files: function () {
        var attachments = this.get( 'attachments' ) || [];
        return attachments.map( function ( attachment ) {
            return new O.Object( attachment );
        }).concat( JMAP.calendar.eventUploads.get( this ) );
    }.property( 'attachments' ),

    addFile: function ( file ) {
        var attachment = new JMAP.CalendarAttachment( file, this );
        JMAP.calendar.eventUploads.add( this, attachment );
        attachment.upload();
        return this;
    },

    removeFile: function ( file ) {
        if ( file instanceof JMAP.CalendarAttachment ) {
            JMAP.calendar.eventUploads.remove( this, file );
        } else {
            var attachments = this.get( 'attachments' ).slice();
            attachments.splice( this.get( 'files' ).indexOf( file ), 1 );
            this.set( 'attachments', attachments.length ? attachments : null );
        }
        return this;
    }
});

JMAP.calendar.replaceEvents = false;
JMAP.calendar.handle( CalendarEvent, {
    precedence: 2,
    fetch: 'getCalendarEvents',
    refresh: function ( _, state ) {
        this.callMethod( 'getCalendarEventUpdates', {
            sinceState: state,
            maxChanges: 100,
            fetchRecords: true
        });
    },
    commit: 'setCalendarEvents',
    // Response handlers
    calendarEvents: function ( args ) {
        var events = args.list,
            l = events.length,
            event, inclusions;
        while ( l-- ) {
            event = events[l];
            inclusions = event.inclusions;
            if ( inclusions ) {
                event.inclusions = inclusions.map( Date.fromJSON );
            }
        }
        this.didFetch( CalendarEvent, args, this.replaceEvents );
        this.replaceEvents = false;
    },
    calendarEventUpdates: function ( args, _, reqArgs ) {
        this.didFetchUpdates( CalendarEvent, args, reqArgs );
        if ( args.hasMoreUpdates ) {
            this.get( 'store' ).fetchAll( CalendarEvent, true );
        }
    },
    error_getCalendarEventUpdates_cannotCalculateChanges: function () {
        JMAP.calendar.flushCache();
    },
    calendarEventsSet: function ( args ) {
        this.didCommit( CalendarEvent, args );
    }
});

// ---

var proxyOverrideAttibute = function ( Type, key ) {
    return function ( value ) {
        var original = this.get( 'original' ),
            originalValue = this.getOriginalForKey( key ),
            exceptions, overrides;
        if ( value !== undefined ) {
            exceptions = O.clone( original.get( 'exceptions' ) );
            overrides = exceptions && exceptions[ this.id ] || {};
            // If equal to original prop, remove from override.
            if ( O.isEqual( value, originalValue ) ) {
                if ( key in overrides ) {
                    delete overrides[ key ];
                    if ( !Object.keys( overrides ).length ) {
                        delete exceptions[ this.id ];
                    }
                    if ( !Object.keys( exceptions ).length ) {
                        exceptions = null;
                    }
                }
            }
            // Otherwise set in exceptions
            else {
                if ( !exceptions ) {
                    exceptions = {};
                }
                exceptions[ this.id ] = overrides;
                overrides[ key ] = value && value.toJSON ?
                    value.toJSON() : value;
            }
            original.set( 'exceptions', exceptions );
        } else {
            overrides = this.get( 'overrides' );
            value = key in overrides ?
                Type.fromJSON ?
                    Type.fromJSON( overrides[ key ] ) :
                    overrides[ key ] :
                originalValue;
        }
        return value;
    }.property( 'overrides', 'original.' + key );
};

var CalendarEventOccurrence = O.Class({

    Extends: O.Object,

    isDragging: false,
    isOccurrence: true,

    mayEdit: CalendarEvent.prototype.mayEdit,
    isInvitation: CalendarEvent.prototype.isInvitation,

    overrides: O.bind( 'original*exceptions', null, function ( exceptions ) {
        var id = this.toObject.id;
        return exceptions && exceptions[ id ] || {};
    }),

    init: function ( original, id, start ) {
        this._start = start;

        this.id = id;
        this.original = original;
        // For attachment upload only
        this.store = original.get( 'store' );
        this.storeKey = original.get( 'storeKey' ) + id;

        CalendarEventOccurrence.parent.init.call( this );
    },

    getOriginalForKey: function ( key ) {
        var original = this.get( 'original' ),
            startTimeZone, endTimeZone, utcStart, utcEnd;
        switch ( key ) {
        case 'start':
            return this._start;
        case 'end':
            startTimeZone = original.get( 'startTimeZone' );
            endTimeZone = original.get( 'endTimeZone' );
            utcStart = startTimeZone ?
                startTimeZone.convertDateToUTC( this._start ) :
                this._start;
            utcEnd = new Date( +utcStart + original.get( 'duration' ) );
            return endTimeZone ?
                endTimeZone.convertDateToTimeZone( utcEnd ) : utcEnd;
        }
        return original.get( key );
    },

    getDoppelganger: function ( store ) {
        var original = this.get( 'original' ),
            originalStore = original.get( 'store' );
        if ( originalStore === store ) {
            return this;
        }
        return original.getDoppelganger( store )
                       ._getOccurrenceForDate( Date.fromJSON( this.id ) );
    },

    destroy: function () {
        var original = this.get( 'original' ),
            exceptions = original.get( 'exceptions' );
        exceptions = exceptions ? O.clone( exceptions ) : {};
        exceptions[ this.id ] = null;
        original.set( 'exceptions', exceptions );

        this.unload();
    },

    unload: function () {
        CalendarEventOccurrence.parent.destroy.call( this );
    },

    is: function ( status ) {
        return this.get( 'original' ).is( status );
    },

    // ---

    // May not edit calendar prop.
    calendar: O.bind( 'original.calendar' ),

    summary: proxyOverrideAttibute( String, 'summary' ),
    description: proxyOverrideAttibute( String, 'description' ),
    location: proxyOverrideAttibute( String, 'location' ),
    showAsFree: proxyOverrideAttibute( Boolean, 'showAsFree' ),

    // ---

    // May not change isAllDay
    isAllDay: O.bind( 'original.isAllDay' ),

    start: proxyOverrideAttibute( Date, 'start' ),
    end: proxyOverrideAttibute( Date, 'end' ),

    startTimeZone: proxyOverrideAttibute( O.TimeZone, 'startTimeZone' ),
    endTimeZone: proxyOverrideAttibute( O.TimeZone, 'endTimeZone' ),

    getStartDateInTZ: CalendarEvent.prototype.getStartDateInTZ,
    getEndDateInTZ: CalendarEvent.prototype.getEndDateInTZ,

    utcStart: CalendarEvent.prototype.utcStart,
    utcEnd: CalendarEvent.prototype.utcEnd,

    localStart: CalendarEvent.prototype.localStart,
    localEnd: CalendarEvent.prototype.localEnd,

    duration: CalendarEvent.prototype.duration,

    // ---

    // Read-only
    recurrence: O.bind( 'original.recurrence' ),

    inclusions: null,
    exceptions: null,

    removedDates: null,

    index: function () {
        var start = this.get( 'start' ),
            original = this.get( 'original' );
        return O.isEqual( start, original.get( 'start' ) ) ? 0 :
            original.get( 'allStartDates' )
                    .binarySearch( Date.fromJSON( this.get( 'id' ) ) );
    }.property().nocache(),

    allStartDates: function () {
        return this.get( 'original' ).get( 'allStartDates' );
    }.property().nocache(),

    totalOccurrences: function () {
        return this.get( 'original' ).get( 'totalOccurrences' );
    }.property().nocache(),

    // ---

    alerts: proxyOverrideAttibute( Array, 'alerts' ),

    // ---

    organizer: proxyOverrideAttibute( Object, 'organizer' ),
    attendees: proxyOverrideAttibute( Array, 'attendees' ),

    rsvp: function ( rsvp ) {
        var original = this.get( 'original' );
        var exceptions = original.get( 'exceptions' );
        var id = this.id;
        // If this is an exception from the organiser, RSVP to just this
        // instance, otherwise RSVP to whole series
        if ( exceptions && exceptions[ id ] &&
                Object.keys( exceptions[ id ] ).some( function ( key ) {
                    return key !== 'alerts';
                }) ) {
            return CalendarEvent.prototype.rsvp.call( this, rsvp );
        }
        if ( rsvp !== undefined ) {
            original.set( 'rsvp', rsvp );
        }
        return original.get( 'rsvp' );
    }.property( 'attendees' ),

    // ---

    attachments: proxyOverrideAttibute( Array, 'attachments' ),

    isUploading: CalendarEvent.prototype.isUploading,
    files: CalendarEvent.prototype.files,
    addFile: CalendarEvent.prototype.addFile,
    removeFile: CalendarEvent.prototype.removeFile
});

JMAP.CalendarEvent = CalendarEvent;
JMAP.CalendarEventOccurrence = CalendarEventOccurrence;

}( JMAP ) );
