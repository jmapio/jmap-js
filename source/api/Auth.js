// -------------------------------------------------------------------------- \\
// File: Auth.js                                                              \\
// Module: API                                                                \\
// Requires: namespace.js                                                     \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const MAIL_DATA = 'urn:ietf:params:jmap:mail';
const CONTACTS_DATA = 'urn:ietf:params:jmap:contacts';
const CALENDARS_DATA = 'urn:ietf:params:jmap:calendars';

const auth = new O.Object({

    isAuthenticated: false,

    username: '',

    accounts: {},
    primaryAccounts: {},
    capabilities: {
        'urn:ietf:params:jmap:core': {
            maxSizeUpload: 50000000,
            maxConcurrentUpload: 10,
            maxSizeRequest: 5000000,
            maxConcurrentRequests: 8,
            maxCallsInRequest: 32,
            maxObjectsInGet: 1024,
            maxObjectsInSet: 1024,
            collationAlgorithms: [
                'i;ascii-numeric',
                'i;ascii-casemap',
            ],
        },
        'urn:ietf:params:jmap:mail': {
            maxSizeAttachmentsPerEmail: 50000000,
            maxMailboxesPerEmail: 1024,
            maxDelayedSend: 0,
            emailListSortOptions: [ 'receivedAt' ],
            submissionExtensions: [],
        },
    },

    authenticationUrl: '',
    apiUrl: '',
    downloadUrl: '',
    uploadUrl: '',
    eventSourceUrl: '',

    MAIL_DATA: MAIL_DATA,
    CONTACTS_DATA: CONTACTS_DATA,
    CALENDARS_DATA: CALENDARS_DATA,

    getAccountId: function ( isPrimary, dataGroup ) {
        var primaryAccountId = this.get( 'primaryAccounts' )[ dataGroup ];
        if ( isPrimary ) {
            return primaryAccountId || null;
        }
        var accounts = this.get( 'accounts' );
        var id;
        for ( id in accounts ) {
            if ( id !== primaryAccountId &&
                    accounts[ id ].hasDataFor.contains( dataGroup ) ) {
                return id;
            }
        }
        return null;
    },

    // ---

    didAuthenticate: function ( data ) {
        // This beginPropertyChanges is functional, as updateAccounts in
        // connections.js needs both accounts and primaryAccounts to be set,
        // but only observes accounts—so we must ensure primaryAccounts is set.
        this.beginPropertyChanges();
        for ( var property in data ) {
            if ( typeof this[ property ] !== 'function' ) {
                this.set( property, data[ property ] );
            }
        }
        this.set( 'isAuthenticated', true );
        this.endPropertyChanges();

        this._awaitingAuthentication.forEach( function ( connection ) {
            connection.send();
        });
        this._awaitingAuthentication.length = 0;

        return this;
    },

    didLoseAuthentication: function () {
        return this.set( 'isAuthenticated', false );
    },

    // ---

    isDisconnected: false,
    timeToReconnect: 0,

    _awaitingAuthentication: [],
    _failedConnections: [],

    _timeToWait: 1,
    _timer: null,

    connectionWillSend: function ( connection ) {
        var isAuthenticated = this.get( 'isAuthenticated' );
        if ( isAuthenticated &&
                !this._failedConnections.contains( connection ) ) {
            return true;
        }
        if ( !isAuthenticated || this._isFetchingSession ) {
            this._awaitingAuthentication.include( connection );
        }
        return false;
    },

    connectionSucceeded: function () {
        if ( this.get( 'isDisconnected' ) ) {
            this._timeToWait = 1;
            this.set( 'isDisconnected', false );
        }
    },

    connectionFailed: function ( connection, timeToWait ) {
        if ( this.get( 'isAuthenticated' ) ) {
            this._failedConnections.include( connection );
            this.retryIn( timeToWait );
        } else {
            this._awaitingAuthentication.include( connection );
        }
    },

    retryIn: function ( timeToWait ) {
        // If we're not already ticking down...
        if ( !this.get( 'timeToReconnect' ) ) {
            // Is this a reconnection attempt already? Exponentially back off.
            timeToWait = this.get( 'isDisconnected' ) ?
                Math.min( this._timeToWait * 2, 300 ) :
                timeToWait || 1;

            this.set( 'isDisconnected', true )
                .set( 'timeToReconnect', timeToWait + 1 );

            this._timeToWait = timeToWait;
            this._timer =
                O.RunLoop.invokePeriodically( this._tick, 1000, this );
            this._tick();
        }
    },

    _tick: function () {
        var timeToReconnect = this.get( 'timeToReconnect' ) - 1;
        this.set( 'timeToReconnect', timeToReconnect );
        if ( !timeToReconnect ) {
            this.retryConnections();
        }
    },

    retryConnections: function () {
        var failedConnections = this._failedConnections;
        O.RunLoop.cancel( this._timer );
        this.set( 'timeToReconnect', 0 );
        this._timer = null;
        this._failedConnections = [];
        failedConnections.forEach( function ( connection ) {
            connection.send();
        });
    }
});

// --- Export

JMAP.auth = auth;

}( JMAP ) );
