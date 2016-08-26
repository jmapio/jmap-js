// -------------------------------------------------------------------------- \\
// File: CalendarEvent.js                                                     \\
// Module: CalendarModel                                                      \\
// Requires: API, Calendar.js, Duration.js, RecurringDate.js                  \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP, undefined ) {

var Record = O.Record;
var attr = Record.attr;

var numerically = function ( a, b ) {
    return a - b;
};

var CalendarEvent = O.Class({

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

    // --- Metadata ---

    calendar: Record.toOne({
        Type: JMAP.Calendar,
        key: 'calendarId'
    }),

    uid: attr( String, {
        noSync: true
    }),

    relatedTo: attr( Array ),

    prodId: attr( String ),

    created: attr( Date, {
        noSync: true
    }),

    updated: attr( Date, {
        noSync: true
    }),

    sequence: attr( Number, {
        defaultValue: 0,
        noSync: true
    }),

    method: attr( String, {
        noSync: true
    }),

    // --- What ---

    title: attr( String, {
        defaultValue: ''
    }),

    description: attr( String, {
        defaultValue: ''
    }),

    // htmlDescription: attr( String, {
    //     defaultValue: ''
    // }),

    // links: attr( Array ),

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
    },

    // ---

    // language: attr( String ),
    // translations: attr( Object ),

    // --- Where ---

    locations: attr( Object, {
        defaultValue: null
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
                        timeZone = O.TimeZone.fromJSON( location.timeZone );
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
                        timeZone = O.TimeZone.fromJSON( location.timeZone );
                    }
                    break;
                }
            }
        }
        return timeZone;
    }.property( 'locations', 'timeZone' ),

    // --- When ---

    isAllDay: attr( Boolean, {
        defaultValue: false
    }),

    start: attr( Date ),

    duration: attr( JMAP.Duration, {
        defaultValue: JMAP.Duration.ZERO
    }),

    timeZone: attr( O.TimeZone, {
        defaultValue: null
    }),

    recurrenceRule: attr( JMAP.RecurringDate, {
        defaultValue: null
    }),

    recurrenceOverrides: attr( Object, {
        defaultValue: null
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
            this.set( 'duration', new JMAP.Duration(
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

    _updateRecurrenceOverrides: function ( _, __, oldStart ) {
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var newRecurrenceOverrides, delta, date;
        if ( this.get( 'store' ).isNested && recurrenceOverrides ) {
            delta = this.get( 'start' ) - oldStart;
            newRecurrenceOverrides = {};
            for ( date in recurrenceOverrides ) {
                newRecurrenceOverrides[
                    new Date( +Date.fromJSON( date ) + delta ).toJSON()
                ] = recurrenceOverrides[ date ];
            }
            this.set( 'recurrenceOverrides', newRecurrenceOverrides );
        }
    }.observes( 'start' ),

    _removeRecurrenceOverrides: function () {
        if ( this.get( 'store' ).isNested && !this.get( 'recurrenceRule' ) ) {
            this.set( 'recurrenceOverrides', null );
        }
    }.observes( 'recurrenceRule' ),

    removedDates: function () {
        var recurrenceOverrides = this.get( 'recurrenceOverrides' );
        var dates = null;
        var date;
        if ( recurrenceOverrides ) {
            for ( date in recurrenceOverrides ) {
                if ( !recurrenceOverrides[ date ] ) {
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
            new CalendarEventOccurrence( this, id )
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
            case 'yearly':
                duration = Math.min( duration, 366 * 24 * 60 * 60 * 1000 );
                break;
            case 'monthly':
                duration = Math.min( duration,  31 * 24 * 60 * 60 * 1000 );
                break;
            case 'weekly':
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
                    if ( occurrence === null ) {
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
                if ( recurrenceOverrides[ id ] === null ) {
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

    // --- Scheduling ---

    status: attr( String, {
        defaultValue: 'confirmed'
    }),

    showAsFree: attr( Boolean, {
        defaultValue: false
    }),

    replyTo: attr( String, {
        defaultValue: null
    }),

    // The id for the calendar owner's participant
    participantId: attr( String, {
        defaultValue: ''
    }),

    participants: attr( Object, {
        defaultValue: null
    }),

    rsvp: function ( rsvp ) {
        var participants = this.get( 'participants' );
        var participantId = this.get( 'participantId' );
        var you = ( participants && participantId &&
            participants[ participantId ] ) || null;
        if ( you && rsvp !== undefined ) {
            participants = O.clone( participants );
            // Don't alert me if I'm not going!
            if ( rsvp === 'declined' ) {
                this.set( 'useDefaultAlerts', false )
                    .set( 'alerts', null );
            }
            // Do alert me if I change my mind!
            else if ( you.rsvp === 'declined' &&
                    this.get( 'alerts' ) === null ) {
                this.set( 'useDefaultAlerts', true );
            }
            participants[ participantId ].scheduleStatus = rsvp;
            this.set( 'participants', participants );
        } else {
            rsvp = you && you.scheduleStatus || '';
        }
        return rsvp;
    }.property( 'participants', 'participantId' ),

    // --- Alerts ---

    useDefaultAlerts: attr( Boolean, {
        defaultValue: false
    }),

    alerts: attr( Object, {
        defaultValue: null
    })
});

var alertOffsetFromJSON = function ( alerts ) {
    if ( !alerts ) {
        return null;
    }
    var id, alert;
    for ( id in alerts ) {
        alert = alerts[ id ];
        alert.offset = new JMAP.Duration( alert.offset );
    }
};

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
        var events = args.list;
        var l = events.length;
        var event;
        while ( l-- ) {
            event = events[l];
            alertOffsetFromJSON( event.alerts );
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

var applyPatch = function ( path, patch, value ) {
    var slash, key;
    while ( true ) {
        slash = path.indexOf( '/' );
        if ( slash > -1 ) {
            key = path.slice( 0, slash );
            path = path.slice( slash + 1 );
        }
        if ( key ) {
            key = key.replace( /~1/g, '/' ).replace( /~0/g, '~' );
        }
        if ( slash > -1 ) {
            value = value[ key ];
        } else {
            if ( patch !== null ) {
                value[ key ] = patch;
            } else {
                delete value[ key ];
            }
            break;
        }
    }
};

var proxyOverrideAttibute = function ( Type, key ) {
    return function ( value ) {
        var original = this.get( 'original' );
        var originalValue = this.getOriginalForKey( key );
        var id = this.id;
        var keyPath = '/' + key;
        var recurrenceOverrides, overrides, keepOverride, path, recurrenceRule;

        if ( value !== undefined ) {
            // Get current overrides for occurrence
            recurrenceOverrides =
                O.clone( original.get( 'recurrenceOverrides' ) ) || {};
            overrides = recurrenceOverrides[ id ] ||
                ( recurrenceOverrides[ id ] = {} );

            // Clear any previous overrides for this key
            keepOverride = false;
            for ( path in overrides ) {
                if ( path.indexOf( keyPath ) === 0 ) {
                    delete overrides[ path ];
                } else {
                    keepOverride = true;
                }
            }
            // Set if different to parent
            if ( !O.isEqual( value, originalValue ) ) {
                keepOverride = true;
                overrides[ keyPath ] = value && value.toJSON ?
                    value.toJSON() : value;
            }

            // Check if we still have any overrides
            if ( !keepOverride ) {
                // Check if matches recurrence rule. If not, keep.
                recurrenceRule = original.get( 'recurrenceRule' );
                if ( recurrenceRule &&
                        recurrenceRule.matches(
                            original.get( 'start' ), this._start
                        )) {
                    delete recurrenceOverrides[ id ];
                }
            }
            if ( !Object.keys( recurrenceOverrides ).length ) {
                recurrenceOverrides = null;
            }

            // Set on original
            original.set( 'recurrenceOverrides', recurrenceOverrides );
        } else {
            overrides = this.get( 'overrides' );
            if ( keyPath in overrides ) {
                return Type.fromJSON ?
                    Type.fromJSON( overrides[ keyPath ] ) :
                    overrides[ keyPath ];
            }
            value = originalValue;
            for ( path in overrides ) {
                if ( path.indexOf( keyPath ) === 0 ) {
                    if ( value === originalValue ) {
                        value = O.clone( originalValue );
                    }
                    applyPatch( path, overrides[ path ], value );
                }
            }
        }
        return value;
    }.property( 'overrides', 'original.' + key );
};

var proxyAttribute = function ( _, key ) {
    return this.get( 'original' ).get( key );
}.property().nocache();

var CalendarEventOccurrence = O.Class({

    Extends: O.Object,

    constructor: CalendarEvent,

    isDragging: false,
    isOccurrence: true,

    isEditable: CalendarEvent.prototype.isEditable,
    isInvitation: CalendarEvent.prototype.isInvitation,

    overrides: O.bind( null, 'original*recurrenceOverrides',
    function ( recurrenceOverrides ) {
        var id = this.toObject.id;
        return recurrenceOverrides && recurrenceOverrides[ id ] || {};
    }),

    init: function ( original, id ) {
        this._start = Date.fromJSON( id );

        this.id = id;
        this.original = original;
        // For attachment upload only
        this.store = original.get( 'store' );
        this.storeKey = original.get( 'storeKey' ) + id;

        CalendarEventOccurrence.parent.init.call( this );
        original.on( 'highlightView', this, 'echoEvent' );
    },

    getOriginalForKey: function ( key ) {
        if ( key === 'start' ) {
            return this._start;
        }
        return this.get( 'original' ).get( key );
    },

    getDoppelganger: function ( store ) {
        var original = this.get( 'original' );
        var originalStore = original.get( 'store' );
        if ( originalStore === store ) {
            return this;
        }
        return original.getDoppelganger( store )
                       ._getOccurrenceForRecurrenceId( this.id );
    },

    clone: CalendarEvent.prototype.clone,

    destroy: function () {
        var original = this.get( 'original' );
        var recurrenceOverrides = original.get( 'recurrenceOverrides' );

        recurrenceOverrides = recurrenceOverrides ?
            O.clone( recurrenceOverrides ) : {};
        recurrenceOverrides[ this.id ] = null;
        original.set( 'recurrenceOverrides', recurrenceOverrides );

        this.unload();
    },

    unload: function () {
        this.get( 'original' ).off( 'highlightView', this, 'echoEvent' );
        CalendarEventOccurrence.parent.destroy.call( this );
    },

    is: function ( status ) {
        return this.get( 'original' ).is( status );
    },

    echoEvent: function ( event ) {
        this.fire( event.type, event );
    },

    // ---

    // May not edit calendar prop.
    calendar: proxyAttribute,
    uid: proxyAttribute,
    relatedTo: proxyAttribute,
    prodId: proxyAttribute,

    created: proxyOverrideAttibute( Date, 'created' ),
    updated: proxyOverrideAttibute( Date, 'updated' ),
    sequence: proxyOverrideAttibute( Number, 'sequence' ),

    // ---

    title: proxyOverrideAttibute( String, 'title' ),
    description: proxyOverrideAttibute( String, 'description' ),
    // htmlDescription: proxyOverrideAttibute( String, 'htmlDescription' ),
    // links: proxyOverrideAttibute( Array, 'links' ),

    attachments: proxyOverrideAttibute( Array, 'attachments' ),

    isUploading: CalendarEvent.prototype.isUploading,
    files: CalendarEvent.prototype.files,
    addFile: CalendarEvent.prototype.addFile,
    removeFile: CalendarEvent.prototype.removeFile,

    // ---

    // language: proxyOverrideAttibute( String, 'language' ),
    // translations: proxyOverrideAttibute( Object, 'translations' ),

    // ---

    locations: proxyOverrideAttibute( Object, 'locations' ),
    location: CalendarEvent.prototype.location,
    startLocationTimeZone: CalendarEvent.prototype.startLocationTimeZone,
    endLocationTimeZone: CalendarEvent.prototype.endLocationTimeZone,

    // ---

    isAllDay: proxyAttribute,

    start: proxyOverrideAttibute( Date, 'start' ),
    duration: proxyOverrideAttibute( JMAP.Duration, 'duration' ),
    timeZone: proxyOverrideAttibute( O.TimeZone, 'timeZone' ),
    recurrence: proxyAttribute,
    recurrenceOverrides: null,

    getStartInTimeZone: CalendarEvent.prototype.getStartInTimeZone,
    getEndInTimeZone: CalendarEvent.prototype.getEndInTimeZone,

    utcStart: CalendarEvent.prototype.utcStart,
    utcEnd: CalendarEvent.prototype.utcEnd,

    end: CalendarEvent.prototype.end,

    removedDates: null,

    allStartDates: proxyAttribute,
    totalOccurrences: proxyAttribute,

    index: function () {
        var start = this.get( 'start' );
        var original = this.get( 'original' );
        return O.isEqual( start, original.get( 'start' ) ) ? 0 :
            original.get( 'allStartDates' ).binarySearch( this._start );
    }.property().nocache(),

    // ---

    status: proxyOverrideAttibute( String, 'status' ),
    showAsFree: proxyOverrideAttibute( Boolean, 'showAsFree' ),
    replyTo: proxyAttribute,
    participantId: proxyAttribute,
    participants: proxyOverrideAttibute( Object, 'participants' ),

    rsvp: function ( rsvp ) {
        var original = this.get( 'original' );
        var recurrenceOverrides = original.get( 'recurrenceOverrides' );
        var id = this.id;
        // If this is an exception from the organizer, RSVP to just this
        // instance, otherwise RSVP to whole series
        if ( recurrenceOverrides && recurrenceOverrides[ id ] &&
                Object.keys( recurrenceOverrides[ id ] ).some(
                function ( key ) {
                    return key !== 'alerts' && key !== 'useDefaultAlerts';
                })) {
            return CalendarEvent.prototype.rsvp.call( this, rsvp );
        }
        if ( rsvp !== undefined ) {
            original.set( 'rsvp', rsvp );
        }
        return original.get( 'rsvp' );
    }.property( 'participants', 'participantId' ),

    // ---

    useDefaultAlerts: proxyOverrideAttibute( Boolean, 'useDefaultAlerts' ),
    alerts: proxyOverrideAttibute( Object, 'alerts' )
});
O.meta( CalendarEventOccurrence.prototype ).attrs =
    O.meta( CalendarEvent.prototype ).attrs;

JMAP.CalendarEvent = CalendarEvent;
JMAP.CalendarEventOccurrence = CalendarEventOccurrence;

}( JMAP ) );
