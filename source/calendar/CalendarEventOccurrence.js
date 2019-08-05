// -------------------------------------------------------------------------- \\
// File: CalendarEventOccurrence.js                                           \\
// Module: CalendarModel                                                      \\
// Requires: CalendarEvent.js                                                 \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP, undefined ) {

const bind = O.bind;
const meta = O.meta;
const clone = O.clone;
const isEqual = O.isEqual;
const TimeZone = O.TimeZone;
const Class = O.Class;
const Obj = O.Object;

const applyPatch = JMAP.Connection.applyPatch;
const makePatches = JMAP.Connection.makePatches;
const CalendarEvent = JMAP.CalendarEvent;
const Duration = JMAP.Duration;

// ---

const mayPatch = {
    links: true,
    translations: true,
    locations: true,
    participants: true,
    alerts: true,
};

const proxyOverrideAttibute = function ( Type, key, attrKey ) {
    return function ( value ) {
        var original = this.get( 'original' );
        var originalValue = this.getOriginalForKey( key );
        var id = this.id;
        var recurrenceOverrides, recurrenceRule;
        var overrides, keepOverride, path;

        if ( !attrKey ) {
            attrKey = key;
        }

        if ( value !== undefined ) {
            // Get current overrides for occurrence
            recurrenceOverrides =
                clone( original.get( 'recurrenceOverrides' ) ) || {};
            overrides = recurrenceOverrides[ id ] ||
                ( recurrenceOverrides[ id ] = {} );

            // Clear any previous overrides for this key
            keepOverride = false;
            for ( path in overrides ) {
                if ( path.indexOf( attrKey ) === 0 ) {
                    delete overrides[ path ];
                } else {
                    keepOverride = true;
                }
            }
            // Set if different to parent
            if ( mayPatch[ attrKey ] ) {
                keepOverride =
                    makePatches( attrKey, overrides, originalValue, value ) ||
                    keepOverride;
            } else if ( !isEqual( originalValue, value ) ) {
                keepOverride = true;
                overrides[ attrKey ] = value && value.toJSON ?
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
            if ( attrKey in overrides ) {
                return Type.fromJSON ?
                    Type.fromJSON( overrides[ attrKey ] ) :
                    overrides[ attrKey ];
            }
            value = originalValue;
            if ( value && mayPatch[ attrKey ] ) {
                for ( path in overrides ) {
                    if ( path.indexOf( attrKey ) === 0 ) {
                        if ( value === originalValue ) {
                            value = clone( originalValue );
                        }
                        applyPatch(
                            value,
                            path.slice( attrKey.length + 1 ),
                            overrides[ path ]
                        );
                    }
                }
            }
        }
        return value;
    }.property( 'overrides', 'original.' + key ).doNotNotify();
};

const proxyAttribute = function ( _, key ) {
    return this.get( 'original' ).get( key );
}.property().nocache();

const CalendarEventOccurrence = Class({

    Extends: Obj,

    constructor: CalendarEvent,

    isDragging: false,
    isOccurrence: true,

    isEditable: CalendarEvent.prototype.isEditable,
    isInvitation: CalendarEvent.prototype.isInvitation,

    overrides: bind( null, 'original*recurrenceOverrides',
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

        CalendarEventOccurrence.parent.constructor.call( this );
        original.on( 'viewAction', this, 'echoEvent' );
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
                       .getOccurrenceForRecurrenceId( this.id );
    },

    clone: function ( store ) {
        var clone = CalendarEvent.prototype.clone.call( this, store );
        return clone.set( 'recurrenceRule', null );
    },

    destroy: function () {
        var original = this.get( 'original' );
        var recurrenceOverrides = original.get( 'recurrenceOverrides' );

        recurrenceOverrides = recurrenceOverrides ?
            clone( recurrenceOverrides ) : {};
        recurrenceOverrides[ this.id ] = { excluded: true };
        original.set( 'recurrenceOverrides', recurrenceOverrides );

        this.unload();
    },

    unload: function () {
        this.get( 'original' ).off( 'viewAction', this, 'echoEvent' );
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

    '@type': 'jsevent',
    uid: proxyAttribute,
    relatedTo: proxyAttribute,
    prodId: proxyAttribute,

    created: proxyOverrideAttibute( Date, 'created' ),
    updated: proxyOverrideAttibute( Date, 'updated' ),
    sequence: proxyOverrideAttibute( Number, 'sequence' ),

    // ---

    title: proxyOverrideAttibute( String, 'title' ),
    description: proxyOverrideAttibute( String, 'description' ),

    // ---

    locations: proxyOverrideAttibute( Object, 'locations' ),
    location: CalendarEvent.prototype.location,
    startLocationTimeZone: CalendarEvent.prototype.startLocationTimeZone,
    endLocationTimeZone: CalendarEvent.prototype.endLocationTimeZone,

    // ---

    links: proxyOverrideAttibute( Object, 'links' ),

    // ---

    // locale: attr( String ),
    // localizations: attr( Object ),

    // keywords: attr( Array ),
    // categories: attr( Array ),
    // color: attr( String ),

    // ---

    isAllDay: proxyAttribute,

    start: proxyOverrideAttibute( Date, 'start' ),
    duration: proxyOverrideAttibute( Duration, 'duration' ),
    timeZone: proxyOverrideAttibute( TimeZone, 'timeZone' ),
    recurrenceRule: proxyAttribute,
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
        return isEqual( start, original.get( 'start' ) ) ? 0 :
            original.get( 'allStartDates' ).binarySearch( this._start );
    }.property().nocache(),

    // ---

    scheduleStatus: proxyOverrideAttibute( String, 'scheduleStatus', 'status' ),
    freeBusyStatus: proxyOverrideAttibute( String, 'freeBusyStatus' ),
    replyTo: proxyAttribute,
    participants: proxyOverrideAttibute( Object, 'participants' ),
    participantNameAndEmails: CalendarEvent.prototype.participantNameAndEmails,
    ownerNameAndEmails: CalendarEvent.prototype.ownerNameAndEmails,
    participantId: proxyAttribute,

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
    alerts: proxyOverrideAttibute( Object, 'alerts' ),
});

meta( CalendarEventOccurrence.prototype ).attrs =
    meta( CalendarEvent.prototype ).attrs;

// --- Export

JMAP.CalendarEventOccurrence = CalendarEventOccurrence;

}( JMAP ) );
