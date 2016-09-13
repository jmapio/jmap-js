// -------------------------------------------------------------------------- \\
// File: CalendarEventOccurrence.js                                           \\
// Module: CalendarModel                                                      \\
// Requires: CalendarEvent.js                                                 \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP, undefined ) {

var CalendarEvent = JMAP.CalendarEvent;

// ---

var mayPatch = {
    links: true,
    translations: true,
    locations: true,
    participants: true,
    alerts: true
};

var makePatches = function ( path, patches, original, current ) {
    var key;
    if ( original && current && typeof current === 'object' &&
            !( current instanceof Array ) ) {
        for ( key in current ) {
            makePatches(
                path + '/' + key.replace( /~/g, '~0' ).replace( /\//g, '~1' ),
                patches,
                original[ key ],
                current[ key ]
            );
        }
        for ( key in original ) {
            if ( !( key in current ) ) {
                makePatches(
                    path + '/' +
                        key.replace( /~/g, '~0' ).replace( /\//g, '~1' ),
                    patches,
                    original[ key ],
                    null
                );
            }
        }
    } else if ( !O.isEqual( original, current ) ) {
        patches.push([ path, current || null ]);
    }
    return patches;
};

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
        var recurrenceOverrides, recurrenceRule;
        var overrides, keepOverride, path, patches;

        if ( value !== undefined ) {
            // Get current overrides for occurrence
            recurrenceOverrides =
                O.clone( original.get( 'recurrenceOverrides' ) ) || {};
            overrides = recurrenceOverrides[ id ] ||
                ( recurrenceOverrides[ id ] = {} );

            // Clear any previous overrides for this key
            keepOverride = false;
            for ( path in overrides ) {
                if ( path.indexOf( key ) === 0 ) {
                    delete overrides[ path ];
                } else {
                    keepOverride = true;
                }
            }
            // Set if different to parent
            if ( mayPatch[ key ] ) {
                patches = makePatches( key, [], originalValue, value );
                if ( patches.length ) {
                    keepOverride = true;
                    patches.forEach( function ( patch ) {
                        overrides[ patch[0] ] = patch[1];
                    });
                }
            } else if ( !O.isEqual( originalValue, value ) ) {
                keepOverride = true;
                overrides[ key ] = value && value.toJSON ?
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
            if ( key in overrides ) {
                return Type.fromJSON ?
                    Type.fromJSON( overrides[ key ] ) :
                    overrides[ key ];
            }
            value = originalValue;
            if ( mayPatch[ key ] ) {
                for ( path in overrides ) {
                    if ( path.indexOf( key ) === 0 ) {
                        if ( value === originalValue ) {
                            value = O.clone( originalValue );
                        }
                        applyPatch( path, overrides[ path ], value );
                    }
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

    links: proxyOverrideAttibute( Object, 'links' ),

    isUploading: CalendarEvent.prototype.isUploading,
    files: CalendarEvent.prototype.files,
    addFile: CalendarEvent.prototype.addFile,
    removeFile: CalendarEvent.prototype.removeFile,

    // ---

    // locale: proxyOverrideAttibute( String, 'locale' ),
    // localizations: proxyOverrideAttibute( Object, 'localizations' ),

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
    participants: proxyOverrideAttibute( Object, 'participants' ),
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
    alerts: proxyOverrideAttibute( Object, 'alerts' )
});
O.meta( CalendarEventOccurrence.prototype ).attrs =
    O.meta( CalendarEvent.prototype ).attrs;

JMAP.CalendarEventOccurrence = CalendarEventOccurrence;

}( JMAP ) );
