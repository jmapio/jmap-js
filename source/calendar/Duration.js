// -------------------------------------------------------------------------- \\
// File: Duration.js                                                          \\
// Module: CalendarModel                                                      \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const durationFormat = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

const Duration = O.Class({
    init: function ( durationInMS ) {
        this._durationInMS = durationInMS;
    },

    valueOf: function () {
        return this._durationInMS;
    },

    toJSON: function () {
        var output = 'P';
        var durationInMS = this._durationInMS;
        var quantity;

        // Days. Also encompasses 0 duration. (P0D).
        if ( !durationInMS || durationInMS > 24 * 60 * 60 * 1000 ) {
            quantity = Math.floor( durationInMS / ( 24 * 60 * 60 * 1000 ) );
            output += quantity;
            output += 'D';
            durationInMS -= quantity * 24 * 60 * 60 * 1000;
        }

        if ( durationInMS ) {
            output += 'T';
            switch ( true ) {
            // Hours
            case durationInMS > 60 * 60 * 1000:
                quantity = Math.floor( durationInMS / ( 60 * 60 * 1000 ) );
                output += quantity;
                output += 'H';
                durationInMS -= quantity * 60 * 60 * 1000;
                /* falls through */
            // Minutes
            case durationInMS > 60 * 1000: // eslint-disable-line no-fallthrough
                quantity = Math.floor( durationInMS / ( 60 * 1000 ) );
                output += quantity;
                output += 'M';
                durationInMS -= quantity * 60 * 1000;
                /* falls through */
            // Seconds
            default: // eslint-disable-line no-fallthrough
                quantity = Math.floor( durationInMS / 1000 );
                output += quantity;
                output += 'S';
            }
        }

        return output;
    }
});

Duration.isEqual = function ( a, b ) {
    return a._durationInMS === b._durationInMS;
};

Duration.fromJSON = function ( value ) {
    var results = value ? durationFormat.exec( value ) : null;
    var durationInMS = 0;
    if ( results ) {
        durationInMS += ( +results[1] || 0 ) * 24 * 60 * 60 * 1000;
        durationInMS += ( +results[2] || 0 ) * 60 * 60 * 1000;
        durationInMS += ( +results[3] || 0 ) * 60 * 1000;
        durationInMS += ( +results[4] || 0 ) * 1000;
    }
    return new Duration( durationInMS );
};

Duration.ZERO = new Duration( 0 );
Duration.AN_HOUR = new Duration( 60 * 60 * 1000 );
Duration.A_DAY = new Duration( 24 * 60 * 60 * 1000 );

JMAP.Duration = Duration;

}( JMAP ) );
