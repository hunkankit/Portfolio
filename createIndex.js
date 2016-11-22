var client = require('./connection.js'); 

client.indices.create({  
  index: 'test',
  body: { 'mappings': 
		{
			'sample': {'properties':
			{
				
				'name': {
				'type': 'string', // type is a required attribute if index is specified
				'index': 'not_analyzed'
						},
				'age': {
				'type': 'long', // type is a required attribute if index is specified
				'index': 'not_analyzed'
						},
				'gender': {
				'type': 'boolean', // type is a required attribute if index is specified
				'index': 'not_analyzed'
						},
				}
			}}
		}		
},function(err,resp,status) {
  if(err) {
    console.log(err);
  }
  else {
    console.log("create",resp);
  }
});