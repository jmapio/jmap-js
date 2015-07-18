// -------------------------------------------------------------------------- \\
// File: connections.js                                                       \\
// Module: API                                                                \\
// Requires: Connection.js                                                    \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP ) {

JMAP.upload = new O.IOQueue({
    maxConnections: 3
});

JMAP.source = new O.AggregateSource({
    sources: [
        JMAP.mail = new JMAP.Connection({
            id: 'mail'
        }),
        JMAP.contacts = new JMAP.Connection({
            id: 'contacts'
        }),
        JMAP.calendar = new JMAP.Connection({
            id: 'calendar'
        }),
        JMAP.peripheral = new JMAP.Connection({
            id: 'peripheral'
        })
    ]
});

JMAP.store = new O.Store({
    source: JMAP.source
});

}( JMAP ) );
