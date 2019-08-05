// -------------------------------------------------------------------------- \\
// File: VacationResponse.js                                                  \\
// Module: MailModel                                                          \\
// Requires: API                                                              \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const Record = O.Record;
const attr = Record.attr;

const mail = JMAP.mail;

// ---

const VacationResponse = Class({

    Extends: Record,

    isEnabled: attr( Boolean, {
        defaultValue: false,
    }),

    fromDate: attr( Date, {
        toJSON: Date.toUTCJSON,
        defaultValue: null,
    }),

    toDate: attr( Date, {
        toJSON: Date.toUTCJSON,
        defaultValue: null,
    }),

    subject: attr( String ),

    textBody: attr( String ),

    htmlBody: attr( String ),

    // ---

    hasDates: function ( hasDates ) {
        if ( hasDates === false ) {
            this.set( 'fromDate', null )
                .set( 'toDate', null );
        } else if ( hasDates === undefined ) {
            hasDates = !!(
                this.get( 'fromDate' ) ||
                this.get( 'toDate' )
            );
        }
        return hasDates;
    }.property( 'fromDate', 'toDate' ),
});
VacationResponse.__guid__ = 'VacationResponse';
VacationResponse.dataGroup = 'urn:ietf:params:jmap:vacationresponse';

mail.handle( VacationResponse, {

    precedence: 3,

    fetch: 'VacationResponse',
    commit: 'VacationResponse',

    // ---

    'VacationResponse/get': function ( args ) {
        this.didFetch( VacationResponse, args );
    },

    'VacationResponse/set': function ( args ) {
        this.didCommit( VacationResponse, args );
    },
});

// --- Export

JMAP.VacationResponse = VacationResponse;

}( JMAP ) );
