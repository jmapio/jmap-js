// -------------------------------------------------------------------------- \\
// File: AmbiguousDate.js                                                     \\
// Module: ContactsModel                                                      \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. All rights reserved.                \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP ) {

var AmbiguousDate = O.Class({

    init: function ( day, month, year ) {
        this.day = day || 0;
        this.month = month || 0;
        this.year = year || 0;
    },

    toJSON: function () {
        return "%'04n-%'02n-%'02n".format(
            this.year, this.month, this.day );
    },

    hasValue: function () {
        return !!( this.day || this.month || this.year );
    },

    yearsAgo: function () {
        if ( !this.year ) { return -1; }
        var now = new Date(),
            ago = now.getFullYear() - this.year,
            nowMonth = now.getMonth(),
            month = ( this.month || 1 ) - 1;
        if ( month > nowMonth ||
                ( month === nowMonth && this.day > now.getDate() ) ) {
            ago -= 1;
        }
        return ago;
    },

    prettyPrint: function () {
        var day = this.day,
            month = this.month,
            year = this.year,
            dateElementOrder = O.i18n.get( 'dateElementOrder' ),
            dayString = day ?
                day + ( year && dateElementOrder === 'mdy' ? ', ' : ' ' ) : '',
            monthString = month ?
                O.i18n.get( 'monthNames' )[ month - 1 ] + ' ' : '',
            yearString = year ? year + ' '  : '';

        return (
            dateElementOrder === 'mdy' ?
                ( monthString + dayString + yearString ) :
            dateElementOrder === 'ymd' ?
                ( yearString + monthString + dayString ) :
                ( dayString + monthString + yearString )
        ).trim();
    }
}).extend({
    fromJSON: function ( json ) {
        var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec( json || '' );
        return parts ?
            new AmbiguousDate( +parts[3], +parts[2], +parts[1] ) : null;
    }
});

JMAP.AmbiguousDate = AmbiguousDate;

}( JMAP ) );
