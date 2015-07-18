// -------------------------------------------------------------------------- \\
// File: Account.js                                                           \\
// Module: API                                                                \\
// Requires: connections.js                                                   \\
// Author: Neil Jenkins                                                       \\
// License: © 2010–2015 FastMail Pty Ltd. All rights reserved.                \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

"use strict";

( function ( JMAP ) {

var Record = O.Record,
    attr = Record.attr;

var Account = O.Class({

    Extends: Record,

    name: attr( String ),

    isPrimary: attr( Boolean),
    isReadOnly: attr( Boolean ),

    hasMail: attr( Boolean ),
    hasContacts: attr( Boolean ),
    hasCalendars: attr( Boolean ),

    capabilities: attr( Object )
});

JMAP.peripheral.handle( Account, {
    fetch: 'getAccounts',
    refresh: 'getAccounts',
    // Response handlers
    accounts: function ( args ) {
        this.didFetch( Account, args, true );
    }
});

JMAP.Account = Account;

}( JMAP ) );
