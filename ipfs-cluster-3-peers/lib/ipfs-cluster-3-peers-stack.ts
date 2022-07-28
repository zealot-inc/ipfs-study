import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';


export class IpfsCluster3PeersStack extends cdk.Stack {
  constructor(app: cdk.App, id: string, props?: cdk.StackProps) {
    super(app, id, props);

    const scope = this;
    const numberOfPeers = 3;
    const volumeNameIPFSNode = 'volume-ipfs-node';
    const volumeNameIPFSCluster = 'volume-ipfs-cluster';

    // VPC
    const vpc = new ec2.Vpc(scope, 'VPC', {
      maxAzs: 2,
    });

    // Service Discovery
    const dnsNamespace = createServiceDiscovery({ scope, vpc });

    // EFS
    const fileSystem = createEFS({ scope, vpc });

    // ECS Cluster
    const cluster = new ecs.Cluster(scope, 'Cluster', { vpc });

    // SecurityGroup for IPFS Service
    const securityGroup = createIPFSServiceSecurityGroup({ scope, vpc });

    Array.from({ length: numberOfPeers }, (_, i) => i)
      .forEach(index => {
        const taskDefinition = createIPFSTaskDefinition({
          scope,
          fileSystem,
          volumeNameIPFSNode,
          volumeNameIPFSCluster,
          index,
        });

        // IPFS Node Container
        const ipfsNodeContainer = createIPFSNodeContainer({
          taskDefinition,
          nodeName: `IPFSNode-${index}`,
          sourceVolume: volumeNameIPFSNode,
        });

        // IPFS Cluster Container
        const _ = createIPFSClusterContainer({
          taskDefinition,
          clusterName: `IPFSCluster-${index}`,
          sourceVolume: volumeNameIPFSCluster,
          ipfsNodeContainer,
        });

        createIPFSPeerService({
          scope,
          cluster,
          securityGroup,
          taskDefinition,
          dnsNamespace,
          index,
        });
      });
  }
}


// --------------------------------------------------------------------------------------------------------------------
// Service Discovery
// --------------------------------------------------------------------------------------------------------------------
function createServiceDiscovery({
  scope,
  vpc,
}: {
  scope: cdk.Stack;
  vpc: ec2.Vpc;
}): servicediscovery.PrivateDnsNamespace {
  const namespace = new servicediscovery.PrivateDnsNamespace(scope, 'Namespace', {
    vpc,
    name: 'ipfs-cluster-3-peers.local',
  });
  return namespace;
}

// --------------------------------------------------------------------------------------------------------------------
// EFS
// --------------------------------------------------------------------------------------------------------------------
function createEFS({
  scope,
  vpc,
}: {
  scope: cdk.Stack;
  vpc: ec2.Vpc;
}): efs.FileSystem {
  // Security Group
  const securityGroup = new ec2.SecurityGroup(scope, 'EFSSecurityGroup', {
    securityGroupName: 'efs-security-group',
    vpc,
    description: 'EFSSecurityGroup',
  });
  securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(2049), 'Allow allow access to EFS');


  // EFS
  const fileSystem = new efs.FileSystem(scope, 'FileSystem', {
    vpc,
    securityGroup,
    encrypted: true,
    lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
    performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
    throughputMode: efs.ThroughputMode.BURSTING,
  });

  return fileSystem;
}

// --------------------------------------------------------------------------------------------------------------------
// SecurityGroup for IPFS Service
// --------------------------------------------------------------------------------------------------------------------
function createIPFSServiceSecurityGroup({
  scope,
  vpc,
}: {
  scope: cdk.Stack;
  vpc: ec2.Vpc;
}): ec2.SecurityGroup {
  // IPFS Service Security Group
  const securityGroup = new ec2.SecurityGroup(scope, `IPFSPeerSecurityGroup`, {
    securityGroupName: `ipfs-peer-security-group`,
    vpc,
    description: `IPFSPeer-SecurityGroup`,
  });
  securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(4001), 'Allow Other IPFS node to connect to this IPFS node');
  securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(4001), 'Allow Other IPFS node to connect to this IPFS node');
  securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5001), 'Allow IPFS node API');
  securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), 'Allow IPFS Gateway');
  securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(9094), 'Allow IPFS Cluster Control');
  securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(9095), 'Allow IPFS Cluster Proxy endpoint');
  securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(9096), 'Allow IPFS Cluster swarm endpoint');

  return securityGroup;
}

// --------------------------------------------------------------------------------------------------------------------
// IPFS Peer + IPFS Cluster Service
// --------------------------------------------------------------------------------------------------------------------
function createIPFSTaskDefinition({
  scope,
  fileSystem,
  volumeNameIPFSNode,
  volumeNameIPFSCluster,
  index,
}: {
  scope: cdk.Stack;
  fileSystem: efs.FileSystem;
  volumeNameIPFSNode: string;
  volumeNameIPFSCluster: string;
  index: number;
}): ecs.FargateTaskDefinition {
  // Access Point for IPFS Node
  const accessPointIPFSNode = new efs.AccessPoint(scope, `AccessPointIPFSNode-${index}`, {
    fileSystem,
    path: `/ipfs${index}`,
    createAcl: {
      ownerUid: '1000',
      ownerGid: '1000',
      permissions: '755',
    },
    posixUser: {
      uid: '1000',
      gid: '1000',
    },
  });

  // Access Point for IPFS Cluster
  const accessPointIPFSCluster = new efs.AccessPoint(scope, `AccessPointIPFSCluster-${index}`, {
    fileSystem,
    path: `/cluster${index}`,
    createAcl: {
      ownerUid: '1000',
      ownerGid: '1000',
      permissions: '755',
    },
    posixUser: {
      uid: '1000',
      gid: '1000',
    },
  });

  // ECS Task Definition
  const taskDefinition = new ecs.FargateTaskDefinition(scope, `IPFSPeer-${index}-TaskDefinition`, {
    memoryLimitMiB: 512,
    cpu: 256,
    volumes: [
      // IPFS Node Volume
      {
        name: volumeNameIPFSNode,
        efsVolumeConfiguration: {
          fileSystemId: fileSystem.fileSystemId,
          authorizationConfig: {
            accessPointId: accessPointIPFSNode.accessPointId,
          },
          transitEncryption: 'ENABLED',
        }
      },
      // IPFS Cluster Volume
      {
        name: volumeNameIPFSCluster,
        efsVolumeConfiguration: {
          fileSystemId: fileSystem.fileSystemId,
          authorizationConfig: {
            accessPointId: accessPointIPFSCluster.accessPointId,
          },
          transitEncryption: 'ENABLED',
        }
      },
    ]
  });

  return taskDefinition;
}

// --------------------------------------------------------------------------------------------------------------------
// IPFS Peer + IPFS Cluster Service
// --------------------------------------------------------------------------------------------------------------------
function createIPFSPeerService({
  scope,
  cluster,
  securityGroup,
  taskDefinition,
  dnsNamespace,
  index,
}: {
  scope: cdk.Stack;
  cluster: ecs.Cluster;
  securityGroup: ec2.SecurityGroup;
  taskDefinition: ecs.TaskDefinition;
  dnsNamespace: servicediscovery.INamespace;
  index: number;
}) {
  // IPFS Service
  new ecs.FargateService(scope, `IPFSPeer-${index}-Service`, {
    cluster,
    taskDefinition,
    serviceName: `IPFSPeer-${index}-Service`,
    desiredCount: 1,
    securityGroups: [securityGroup],
    vpcSubnets: cluster.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
    }),
    assignPublicIp: true, // TODO: set "false" when using an LB
    cloudMapOptions: {
      name: `ipfs-peer-${index}`,
      cloudMapNamespace: dnsNamespace,
      dnsRecordType: servicediscovery.DnsRecordType.A,
    }
  });
}

// --------------------------------------------------------------------------------------------------------------------
// IPFS Node Container
// --------------------------------------------------------------------------------------------------------------------
function createIPFSNodeContainer({
  taskDefinition,
  nodeName,
  sourceVolume,
}: {
  taskDefinition: ecs.FargateTaskDefinition;
  nodeName: string;
  sourceVolume: string;
}): ecs.ContainerDefinition {
  // IPFS Node Container
  const ipfsNodeContainer = taskDefinition.addContainer(`${nodeName}-Container`, {
    containerName: 'ipfs-node',
    image: ecs.ContainerImage.fromRegistry('ipfs/go-ipfs:latest'),
    portMappings: [
      { containerPort: 4001, protocol: ecs.Protocol.TCP },
      { containerPort: 4001, protocol: ecs.Protocol.UDP },
      { containerPort: 5001, protocol: ecs.Protocol.TCP },
      { containerPort: 8080, protocol: ecs.Protocol.TCP },
    ],
    healthCheck: {
      command: ["wget -q -O - --post-data '' http://127.0.0.1:5001/api/v0/version || exit 1"],
      interval: cdk.Duration.seconds(60),
      timeout: cdk.Duration.seconds(5),
      startPeriod: cdk.Duration.seconds(3),
      retries: 3,
    },
    environment: {
      IPFS_LOGGING: 'info',
    },
  });

  // Mount EFS Volume
  ipfsNodeContainer.addMountPoints({
    sourceVolume,
    containerPath: '/data/ipfs',
    readOnly: false,
  });

  return ipfsNodeContainer;
}

// --------------------------------------------------------------------------------------------------------------------
// IPFS Cluster Container
// --------------------------------------------------------------------------------------------------------------------
function createIPFSClusterContainer({
  taskDefinition,
  clusterName,
  sourceVolume,
  ipfsNodeContainer,
}: {
  taskDefinition: ecs.FargateTaskDefinition;
  clusterName: string;
  sourceVolume: string;
  ipfsNodeContainer: ecs.ContainerDefinition;
}): ecs.ContainerDefinition {
  const clusterSecret = process.env.IPFS_CLUSTER_SECRET ?? '';

  // IPFS Cluster Container
  const ipfsClusterContainer = taskDefinition.addContainer(`${clusterName}-Container`, {
    containerName: 'ipfs-cluster',
    image: ecs.ContainerImage.fromRegistry('ipfs/ipfs-cluster:latest'),
    portMappings: [
      { containerPort: 9094, protocol: ecs.Protocol.TCP },
      { containerPort: 9095, protocol: ecs.Protocol.TCP },
      { containerPort: 9096, protocol: ecs.Protocol.TCP },
    ],
    environment: {
      CLUSTER_CRDT_TRUSTEDPEERS: '*',
      CLUSTER_IPFSHTTP_NODEMULTIADDRESS: '/ip4/127.0.0.1/tcp/5001',
      CLUSTER_MONITORPINGINTERVAL: '2s',
      CLUSTER_PEERNAME: clusterName,
      CLUSTER_RESTAPI_HTTPLISTENMULTIADDRESS: '/ip4/0.0.0.0/tcp/9094',
      CLUSTER_SECRET: clusterSecret,
    },
  });

  // Container Depends on IPFS Node Container
  ipfsClusterContainer.addContainerDependencies({
    container: ipfsNodeContainer,
    condition: ecs.ContainerDependencyCondition.START,
  });

  // Mount EFS Volume
  ipfsClusterContainer.addMountPoints({
    sourceVolume,
    containerPath: '/data/ipfs-cluster',
    readOnly: false,
  });

  return ipfsClusterContainer;
}
