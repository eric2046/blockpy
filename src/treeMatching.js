//StretchyTreeMatcher.prototype = new NodeVisitor();
//ASTMap.prototype = new Object();
//CT_Map.prototype = new Object();
function CT_Map(){
	this.keys = [];
	this.values = [];
	this.cacheKey = null;
	this.cacheIndex = -1;
}
CT_Map.prototype.updateCache = function(key){
	if(this.cacheIndex == -1 || !(this.cacheKey === key)){
		this.cacheKey = key;
		this.cacheIndex = this.keys.indexOf(key);
	}
}
CT_Map.prototype.clearCache = function(){
	this.cacheKey = null;
	this.cacheIndex = -1;
}
CT_Map.prototype.clear = function(){
	this.keys = [];
	this.values = [];
	this.clearCache();
}
CT_Map.prototype.delete = function(key){
	this.updateCache(key);
	this.keys.splice(this.cacheIndex, 1);
	this.clearCache();
}
CT_Map.prototype.get = function(key){
	this.updateCache(key);
	return this.values[this.cacheIndex];
}
CT_Map.prototype.has = function(key){
	this.updateCache(key);
	return this.cacheIndex >= 0;
}
CT_Map.prototype.keys = function(){
	return this.keys;
}
CT_Map.prototype.values = function(){
	return this.values;
}
CT_Map.prototype.set = function(key, value){
	this.updateCache(key);
	if(this.cacheIndex === -1){
		this.keys.push(key);
		this.values.push(value);
	}else{
		this.values[this.cacheIndex] = value;
	}
}
CT_Map.prototype.size = function(){
	return this.keys.length;
}

function ASTMap(){
	this.mappings = new CT_Map();
	this.symbolTable = new CT_Map();
	this.conflictKeys = [];
}

/**
Adds insNode.id to the symbol table if it doesn't already exist,
mapping it to a set of insNode.
Updates a second dictionary that maps insNode to an stdNode, and overwrites
the current stdNode since there should only be one mapping.
*/
ASTMap.prototype.addVarToSymbolTable = function(insNode, stdNode){
	var key = null;
	if(typeof insNode == "string"){
		key = insNode;
	}else{
		key = Sk.ffi.remapToJs(insNode.astNode.id);
	}

	var value = new Object();
	value.id = Sk.ffi.remapToJs(stdNode.astNode.id);
	value.node = stdNode.astNode;

	var newList = null;
	if(this.symbolTable.has(key)){
		newList = this.symbolTable.get(key);
		newList.push(value);
		if(this.conflictKeys.indexOf(key) === -1){
			for(var i = 0; i < newList.length; i += 1){
				var other = newList[i];
				if(value.id != other.id){
					this.conflictKeys.push(key);
					break;
				}
			}
		}
	}else{
		newList = [value];
	}
	this.symbolTable.set(key, newList);
}
ASTMap.prototype.addExpToSymbolTable = function(insNode, stdNode){
	var key = Sk.ffi.remapToJs(insNode.astNode.id);
	this.symbolTable.set(key, stdNode.astNode);
}

ASTMap.prototype.addNodePairing = function(insNode, stdNode){
	this.mappings.set(insNode.astNode, stdNode.astNode);
}
ASTMap.prototype.mergeMapWith = function(other){
	//TODO: check if other is also an ASTMap.
	//merge all mappings
	var otherMap = other.mappings;
	for(var i = 0; i < otherMap.keys.length; i += 1){
		this.mappings.set(otherMap.keys[i], otherMap.values[i]);
	}
	//merge all symbols
	var otherSym = other.symbolTable;
	for(var i = 0; i < otherSym.keys.length; i += 1){
		var value = otherSym.values[i];
		for(var j = 0; j < value.length; j += 1){
			this.addVarToSymbolTable(otherSym.keys[i], new EasyNode(value[j].node));
		}
	}
}
function EasyNode(astNode, myField){
	this.children = [];
	this.astNode = astNode;
	this.field = myField;
	var myFieldList = iter_fields(this.astNode);
	for (var i = 0; i < myFieldList.length; i += 1) {
		var field = myFieldList[i][0];
		var value = myFieldList[i][1];
		//if the field doesn't have a value, no child exists
		if (value === null) {
			continue;
		}
		//If the children are not in an array, wrap it in an array for consistency in the code the follows
		if(!(Array === value.constructor)){
			value = [value];
		}
		//Reference ast_node_visitor.js for the original behavior and keep note of it for the purposes of handling the children noting the special case when the nodes of the array are actually parameters of the node (e.g. a load function) instead of a child node
		for (var j = 0; j < value.length; j += 1) {
			//if the item in the array is actually a child astNode
			var subvalue = value[j];
			if (isAstNode(subvalue)) {
				this.children.push(new EasyNode(subvalue, field));
			}
		}
	}
}

function StretchyTreeMatcher(code){
	//TODO: check that both are ast nodes at the module level
	var astNode = null;
	if(typeof code == "string"){
		var filename = "__main__"
		var parse = Sk.parse(filename, code);
		astNode = Sk.astFromParse(parse.cst, filename, parse.flags);
	}else{
		astNode = code;
	}
	this.rootNode = new EasyNode(astNode, "none");
}


StretchyTreeMatcher.prototype.findMatches = function(other){
	//TODO: check that both are ast nodes at the module level
	var otherTree = null;
	if(typeof other == "string"){
		var filename = "__main__";
		var parse = Sk.parse(filename, other);
		otherTree = Sk.astFromParse(parse.cst, filename, parse.flags);
	}else{
		otherTree = other;
	}
	var easyOther = new EasyNode(otherTree, "none");
	return this.anyNodeMatch(this.rootNode, easyOther);
}

/**
	Finds whether insNode can be matched to some node in the tree stdNode
	@return a mapping of nodes and a symbol table mapping insNode to some node in the tree stdNode or false if such a matching does not exist
**/
StretchyTreeMatcher.prototype.anyNodeMatch = function(insNode, stdNode){
	//@TODO: create a more public function that converts insNode and stdNode into EasyNodes
	//matching: an object representing the mapping and the symbol table
	var matching = this.deep_findMatch(insNode, stdNode);
	//if a direct matching is found
	if(matching){
		return matching;//return it
	}else{//otherwise
		var foundMatch = false;
		//try to matching insNode to each child of stdNode, recursively
		for(var i = 0; i < stdNode.children.length; i += 1){
			var stdChild = stdNode.children[i];
			matching = this.anyNodeMatch(insNode, stdChild);
			if (matching){
				return matching;
			}
		}
	}
	return false;
}

/**
	Finds whether insNode and matches stdNode and whether insNode's children flexibly match stdNode's children in order
	@return a mapping of nodes and a symbol table mapping insNode to stdNode
**/
StretchyTreeMatcher.prototype.deep_findMatch = function(insNode, stdNode){
	var baseMappings = this.shallowMatch(insNode, stdNode);
	if (baseMappings){
		//base case this runs 0 times because no children
		//find each child of insNode that matches IN ORDER
		var j = 0;
		for(var i = 0; i < insNode.children.length; i += 1){
			var insChild = insNode.children[i];
			matches = false
			//@TODO: make this multimatch (get rid of !matches)
			for(;j < stdNode.children.length && !matches; j += 1){
				var stdChild = stdNode.children[j];
				var newMapping = this.deep_findMatch(insChild, stdChild);
				if (newMapping){
					baseMappings.mergeMapWith(newMapping);
					matches = true;
				}
			}
			if (!matches){
				return false;
			}
		}
		return baseMappings;
	}
	return false;
}
/**
	Flexibly matches a module node to a module or a body
	@return a mapping of insNode to stdNode, or false if doesn't match
**/
StretchyTreeMatcher.prototype.shallowMatch_Module = function(insNode, stdNode){
	if(stdNode.astNode._astname == "Module" || stdNode.field == "body"){
		var mapping = new ASTMap();
		mapping.addNodePairing(insNode, stdNode);
		return mapping;
	}
	return false;
}
/**
	Matches insNode to stdNode for different cases of encountering a name node in insNode
		case 1: _var_ matches if stdNode is a name node and automatically returns a mapping and symbol table
		case 2: __exp__ matches to any subtree and automatically returns a mapping and symbol table
		case 3: ___ matches to any subtree and automatically returns a mapping
		case 4: matches only if the exact names are the same (falls through to shallowMatch_generic)
	@return a mapping of insNode to stdNode and possibly a symbolTable, or false if it doesn't match
**/
StretchyTreeMatcher.prototype.shallowMatch_Name = function(insNode, stdNode){
	var id = Sk.ffi.remapToJs(insNode.astNode.id);
	var varMatch = /^_[^_].*_$/;//regex
	var expMatch = /^__.*__$/;//regex
	var wildCard =/^___$/;//regex
	var mapping = new ASTMap();
	var matched = false;
	if(varMatch.test(id)){//variable
		if(stdNode.astNode._astname == "Name"){
			var result = mapping.addVarToSymbolTable(insNode, stdNode);
			matched = true;
		}//could else return false, but shallowMatch_generic should do this as well
	}else if(expMatch.test(id)){//expression
		mapping.addExpToSymbolTable(insNode, stdNode);
		matched = true;
	}else if(wildCard.test(id)){//don't care
		matched = true;
	}
	if(matched){
		mapping.addNodePairing(insNode, stdNode);
		return mapping;
	}//else
	return this.shallowMatch_generic(insNode, stdNode);
}
/**
	An empty loop body should match to anything
	@return a mappping of insNode to stdNode
**/
StretchyTreeMatcher.prototype.shallowMatch_pass = function(insNode, stdNode){
	var mapping = new ASTMap();
	return mapping.addNodePairing(insNode, stdNode);
}
/**
	Checks that all non astNode attributes are equal between insNode and stdNode
	@return a mappin gof insNode to stdNode, or false, if the attributes aren't equal
**/
StretchyTreeMatcher.prototype.shallowMatch_generic = function(insNode, stdNode){
	ins = insNode.astNode;
	std = stdNode.astNode;
	var insFieldList = iter_fields(ins);
	var stdFieldList = iter_fields(std);
	var isMatch = insFieldList.length === stdFieldList.length && ins._astname === std._astname;
	for (var i = 0; i < insFieldList.length && isMatch; i += 1){
		var insField = insFieldList[i][0];
		var insValue = insFieldList[i][1];
		var stdField = stdFieldList[i][0];
		var stdValue = stdFieldList[i][1];

		if(insValue === null){
			continue;
		}
		if(!(Array === insValue.constructor)){
			insValue = [insValue];
		}
		if(!(Array === stdValue.constructor)){
			stdValue = [stdValue];
		}
		isMatch = insValue.length === stdValue.length;
		//Reference ast_node_visitor.js for the original behavior and keep note of it for the purposes of handling the children noting the special case when the nodes of the array are actually parameters of the node (e.g. a load function) instead of a child node
		for (var j = 0; j < insValue.length && isMatch; j += 1) {
			var insSubvalue = insValue[j];
			var stdSubvalue = stdValue[j];
			//TODO: make this a smarter comparison
			if(isSkBuiltin(insSubvalue) && isSkBuiltin(stdSubvalue)){
				//TODO: make this work for actual objects/dictionaries?
				isMatch = Sk.ffi.remapToJs(insSubvalue) === Sk.ffi.remapToJs(stdSubvalue);
			}
		}
	}
	if(isMatch){
		isMatch = new ASTMap();//return MAPPING
		isMatch.addNodePairing(insNode, stdNode);
	}
	return isMatch;
}

//filter function for various types of nodes
StretchyTreeMatcher.prototype.shallowMatch = function(insNode, stdNode){
	var method_name = 'shallowMatch_' + insNode.astNode._astname;
	if (method_name in this){
		return this[method_name](insNode, stdNode);
	}//else
	return this.shallowMatch_generic(insNode, stdNode);
}