/*global require, process, console */

"use strict";

var fs = require( 'fs' );

Array.prototype.include = function ( item ) {
    var i, l;
    for ( i = 0, l = this.length; i < l; i += 1 ) {
        if ( this[i] === item ) {
            return this;
        }
    }
    this[l] = item;
    return this;
};

var stripStrict = function ( string ) {
    return string.replace( /^\s*"use strict"[;,]\n?/m, '' );
};

var groupIntoModules = function ( files ) {
    var modules = {};
    files.forEach( function ( file ) {
        var moduleName = file.module;
        if ( !moduleName ) {
            throw new Error( 'File ' + file.src + ' belongs to no module!' );
        }
        var module = modules[ moduleName ] = ( modules[ moduleName ] || {
            name: moduleName,
            dependencies: [],
            files: []
        });
        module.files.push( file );
        file.dependencies = file.dependencies.filter( function ( dependency ) {
            if ( dependency.slice( -3 ) !== '.js' ) {
                module.dependencies.include( dependency );
                return false;
            }
            return true;
        });
    });
    var result = [];
    for ( var m in modules ) {
        result.push( modules[m] );
    }
    return result;
};

var sort = function ( array ) {
    var tree = {};
    array.forEach( function ( obj ) {
        tree[ obj.name ] = {
            obj: obj
        };
    });
    array.forEach( function ( obj ) {
        tree[ obj.name ].dependencies =
                obj.dependencies.map( function ( name ) {
            var dependency = tree[ name ];
            if ( !dependency ) {
                console.log( obj.name + ' requires ' + name +
                    ' but we do not have it!' );
            }
            return dependency;
        });
    });
    var result = [];
    var output = function output( node ) {
        if ( node.isOutput ) { return; }
        node.dependencies.forEach( function ( dependency ) {
            output( dependency );
        });
        node.isOutput = true;
        result.push( node.obj );
    };
    for ( var key in tree ) {
        if ( tree.hasOwnProperty( key ) ) {
            output( tree[ key ] );
        }
    }
    return result;
};

var sortByDependencies = function ( files ) {
    var parsers = {
        name: /^\/\/\sFile:([^\\]+)\\\\$/m,
        module: /^\/\/\sModule:([^\\]+)\\\\$/m,
        dependencies: /^\/\/\sRequires:([^\\]+)\\\\$/m
    };
    var parsed = files.map( function ( file ) {
        var info = {
            data: file
        };
        for ( var attr in parsers ) {
            var value = parsers[ attr ].exec( file ) || '';
            // Get first capture group and clean it.
            if ( value ) { value = value[1].replace( /\s/g, '' ); }
            if ( attr === 'dependencies' ) {
                value = value ? value.split( ',' ) : [];
            }
            info[ attr ] = value;
        }
        return info;
    });
    var modules = sort( groupIntoModules( parsed ) );

    return modules.reduce( function ( array, module ) {
        sort( module.files ).forEach( function ( file ) {
            array.push( file.data );
        });
        return array;
    }, [] );
};

var makeModule = function ( inputs, output ) {
    // Always keep in the same order.
    inputs.sort();
    var module = '"use strict";\n\n';
    var jsData = inputs.map( function ( input ) {
        return stripStrict( fs.readFileSync( input, 'utf8' ) );
    });

    module += sortByDependencies( jsData ).join( '\n\n' );

    fs.writeFile( output, module );
};

var args = process.argv.slice( 2 ),
    sourceFiles = args.slice( 0, -1 ),
    outputFiles = args[ args.length - 1 ];

makeModule( sourceFiles, outputFiles );
